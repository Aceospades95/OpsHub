/**
 * Google sign-in helper — runs inside the NextAuth `signIn` callback.
 *
 * Goal: when someone signs in via Google for the first time, link the
 * Google identity to the existing `User` row (matched by email) instead
 * of creating a duplicate. Pre-provisioned admin/manager accounts that
 * the org sets up before the person ever logs in must keep their id,
 * role, and permissions.
 *
 * The function returns either `true` (let NextAuth proceed and issue
 * a session), `false` (default reject → /login?error=AccessDenied), or
 * a redirect path string with a specific `error` code so the login
 * page can show a clear, non-generic message.
 *
 * Security gates, in order:
 *   1. profile.email_verified === true  — without this, anyone could
 *      register a Google identity for someone else's wynndalco email
 *      and silently take over the pre-provisioned User row.
 *   2. Domain allowlist (when AllowedDomain has any rows)
 *   3. hasLoginAccess + isActive on the matched User
 *   4. Refuse to link when 2+ Users with the same email exist (data
 *      corruption guard — choosing one would be a coin-flip security
 *      bug; the operator runs prisma/merge-duplicate-users.ts to
 *      resolve, then sign-in works).
 *
 * Linking writes an Account row tying (provider="google",
 * providerAccountId) to the existing User. The User row itself is
 * untouched apart from a one-time avatar fill if it had no avatar.
 * hashedPassword and authProvider are deliberately left alone so a
 * user with both methods configured can keep using either.
 */

import type { Account, Profile, User as NextAuthUser } from "next-auth";
import type { PrismaClient } from "@prisma/client";

export type SignInOutcome = true | false | string;

export interface GoogleSignInDeps {
  /** Prisma client (or a test double exposing .account, .user, .allowedDomain). */
  db: Pick<PrismaClient, "account" | "user" | "allowedDomain">;
  /** Logger for the data-corruption / race-condition error paths. */
  log?: (message: string) => void;
}

export interface GoogleSignInInput {
  user: NextAuthUser | undefined;
  account: Account | null | undefined;
  profile: Profile | undefined;
}

/**
 * Process a Google `signIn` callback. Returns `true` to allow,
 * `false` to fall back to NextAuth's default rejection, or a
 * redirect string `/login?error=...` to surface a specific message.
 */
export async function handleGoogleSignIn(
  { user, account, profile }: GoogleSignInInput,
  { db, log = console.error }: GoogleSignInDeps
): Promise<SignInOutcome> {
  if (account?.provider !== "google") return true;

  const rawEmail = user?.email ?? profile?.email ?? null;
  if (!rawEmail) return "/login?error=NoEmail";

  const email = String(rawEmail).trim().toLowerCase();
  const domain = email.split("@")[1];
  if (!domain) return "/login?error=InvalidEmail";

  // Email-verification gate. Google's `email_verified` claim is the
  // only thing standing between "your wynndalco email" and "anyone
  // who can spin up a Google account using that string". REJECT if
  // it isn't explicitly true — undefined is not enough.
  const verifiedRaw = (profile as { email_verified?: unknown })?.email_verified;
  if (verifiedRaw !== true) {
    return "/login?error=EmailNotVerified";
  }

  // Domain allowlist. Empty list = unrestricted.
  const allowedDomains = await db.allowedDomain.findMany();
  if (allowedDomains.length > 0) {
    const isAllowed = allowedDomains.some(
      (d) => d.domain.toLowerCase() === domain
    );
    if (!isAllowed) return "/login?error=DomainNotAllowed";
  }

  // Path 1: this Google identity already has an Account row. Standard
  // returning-user flow. Re-check the gates in case the User was
  // disabled since the last sign-in.
  if (account.providerAccountId) {
    const existingAccount = await db.account.findUnique({
      where: {
        provider_providerAccountId: {
          provider: "google",
          providerAccountId: account.providerAccountId,
        },
      },
      include: { user: true },
    });
    if (existingAccount) {
      const u = existingAccount.user;
      if (!u.isActive || !u.hasLoginAccess) {
        return "/login?error=Disabled";
      }
      if (!u.avatar && user?.image) {
        await db.user.update({
          where: { id: u.id },
          data: { avatar: user.image },
        });
      }
      return true;
    }
  }

  // Path 2: no linked Account yet. Look up the User by case-insensitive
  // email. We `take: 2` so we can detect the duplicate-row corruption
  // case without scanning the whole table.
  const matches = await db.user.findMany({
    where: { email: { equals: email, mode: "insensitive" } },
    take: 2,
  });

  if (matches.length > 1) {
    log(
      `[auth] Refusing Google sign-in for ${email}: ${matches.length} User rows match. ` +
        `Run prisma/merge-duplicate-users.ts to consolidate.`
    );
    return "/login?error=DuplicateEmail";
  }

  if (matches.length === 1) {
    const existing = matches[0];
    if (!existing.isActive || !existing.hasLoginAccess) {
      return "/login?error=Disabled";
    }

    if (account.providerAccountId) {
      try {
        await db.account.create({
          data: {
            userId: existing.id,
            type: account.type ?? "oauth",
            provider: "google",
            providerAccountId: account.providerAccountId,
            refresh_token: account.refresh_token ?? null,
            access_token: account.access_token ?? null,
            expires_at:
              typeof account.expires_at === "number" ? account.expires_at : null,
            token_type: account.token_type ?? null,
            scope: account.scope ?? null,
            id_token: account.id_token ?? null,
            session_state:
              typeof account.session_state === "string" ? account.session_state : null,
          },
        });
      } catch (err) {
        // Race: another concurrent sign-in inserted the Account row
        // between our findUnique and create. P2002 = unique constraint.
        // Re-resolve and accept iff the existing row points at the same
        // user we matched on — otherwise log + reject so a duplicate-
        // identity attack can't slip through.
        const code = (err as { code?: string }).code;
        if (code === "P2002") {
          const fresh = await db.account.findUnique({
            where: {
              provider_providerAccountId: {
                provider: "google",
                providerAccountId: account.providerAccountId,
              },
            },
          });
          if (!fresh || fresh.userId !== existing.id) {
            log(
              `[auth] Account race for ${email}: linked to a different user. Aborting.`
            );
            return "/login?error=DuplicateEmail";
          }
        } else {
          throw err;
        }
      }
    }

    if (!existing.avatar && user?.image) {
      await db.user.update({
        where: { id: existing.id },
        data: { avatar: user.image },
      });
    }
    return true;
  }

  // Path 3: no matching User. Auto-provision as GUEST (existing
  // behavior — the role can only be raised by a manager/admin
  // assigning them work, never by Google itself) and write the
  // Account link in the same flow.
  const created = await db.user.create({
    data: {
      name: user?.name || email.split("@")[0],
      email,
      authProvider: "google",
      avatar: user?.image || null,
      role: "GUEST",
    },
  });

  if (account.providerAccountId) {
    await db.account.create({
      data: {
        userId: created.id,
        type: account.type ?? "oauth",
        provider: "google",
        providerAccountId: account.providerAccountId,
        refresh_token: account.refresh_token ?? null,
        access_token: account.access_token ?? null,
        expires_at:
          typeof account.expires_at === "number" ? account.expires_at : null,
        token_type: account.token_type ?? null,
        scope: account.scope ?? null,
        id_token: account.id_token ?? null,
        session_state:
          typeof account.session_state === "string" ? account.session_state : null,
      },
    });
  }
  return true;
}
