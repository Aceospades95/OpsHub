/**
 * One-time signup / password-reset tokens.
 *
 * Three things this module owns:
 *   1. Generating a fresh token for a User (issueSignupToken). Replaces
 *      any prior token — re-inviting a user invalidates the old link.
 *   2. Validating a raw token without consuming it (peekSignupToken).
 *      Used by the GET on /signup/[token] so we can render the
 *      set-password form or a "this link is no longer valid" page
 *      without committing to a state change.
 *   3. Consuming a token (consumeSignupToken). Atomically marks the
 *      token used + sets the user's password hash. Once a token is
 *      consumed it can't be replayed.
 *
 * Storage shape is deliberately minimal — see the SignupToken model
 * in prisma/schema.prisma. We never store the raw token; we only
 * store its SHA-256 hash and lookup by that. A leaked database dump
 * can't be used to forge invites.
 */

import { createHash, randomBytes } from "crypto";
import { hash } from "bcryptjs";

import { db } from "@/lib/db";
import { consume } from "@/lib/rate-limit";

/** 24h is the conventional invite-link lifetime — long enough that
 *  a recipient can act on it after a long flight, short enough that
 *  a stolen URL has a small window. */
export const INVITE_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
/** Password resets get the same lifetime by default. */
export const RESET_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

/** Bcrypt cost. 12 matches the rest of the codebase (createUser /
 *  reset action) so verify-time stays consistent across flows. */
const BCRYPT_COST = 12;

export type SignupTokenKind = "invite" | "reset";

/**
 * Brute-force throttle on token validation. Keyed by a short prefix of
 * the token hash (caps hammering of a single guessed token) plus a
 * global backstop bucket (caps a scanner spraying many distinct
 * guesses, which would otherwise land in fresh per-token buckets).
 * Lives here rather than in the page/action so every lookup path is
 * covered. On limit the caller behaves exactly like an invalid token —
 * no oracle distinguishing "throttled" from "miss".
 */
function signupTokenRateLimited(tokenHash: string): boolean {
  const perToken = consume(`signup:${tokenHash.slice(0, 8)}`, {
    capacity: 10,
    refillRatePerSec: 1 / 60,
  });
  const global = consume("signup:all", {
    capacity: 100,
    refillRatePerSec: 1,
  });
  return !perToken.allowed || !global.allowed;
}

export interface IssuedToken {
  /** The raw token value the user receives in their email URL. */
  rawToken: string;
  /** Absolute path component (`/signup/{token}`) — caller wraps in absoluteUrl. */
  signupPath: string;
  /** When the token expires. Echoed to the email copy. */
  expiresAt: Date;
}

/**
 * Generate a fresh token for `userId`. Replaces any existing token —
 * one row per user, so re-inviting deletes the old hash.
 *
 * `kind` is informational only; the validate / consume flow is the
 * same. The email layer reads it to pick "Welcome to OpsHub" vs
 * "Reset your password" copy.
 */
export async function issueSignupToken(
  userId: string,
  kind: SignupTokenKind,
  ttlMs: number = kind === "reset" ? RESET_TOKEN_TTL_MS : INVITE_TOKEN_TTL_MS
): Promise<IssuedToken> {
  // 32 random bytes → 64 hex chars. Plenty of entropy; URL-safe.
  const rawToken = randomBytes(32).toString("hex");
  const tokenHash = createHash("sha256").update(rawToken).digest("hex");
  const expiresAt = new Date(Date.now() + ttlMs);

  await db.signupToken.upsert({
    where: { userId },
    update: { tokenHash, kind, expiresAt, usedAt: null },
    create: { userId, tokenHash, kind, expiresAt, usedAt: null },
  });

  return {
    rawToken,
    signupPath: `/signup/${rawToken}`,
    expiresAt,
  };
}

export type PeekResult =
  | { ok: true; userId: string; kind: SignupTokenKind; userName: string; userEmail: string }
  | { ok: false; reason: "missing" | "expired" | "used" };

/**
 * Look up a token without consuming it. Returns enough info for the
 * /signup/[token] page to greet the user by name and pick the right
 * copy (invite vs reset). Distinguishes between the failure modes so
 * the page can show "expired" vs "already used" vs "never existed".
 */
export async function peekSignupToken(rawToken: string): Promise<PeekResult> {
  if (!rawToken || typeof rawToken !== "string") {
    return { ok: false, reason: "missing" };
  }
  const tokenHash = createHash("sha256").update(rawToken).digest("hex");
  if (signupTokenRateLimited(tokenHash)) {
    return { ok: false, reason: "missing" };
  }
  const row = await db.signupToken.findUnique({
    where: { tokenHash },
    include: { user: { select: { id: true, name: true, email: true } } },
  });
  if (!row) return { ok: false, reason: "missing" };
  if (row.usedAt) return { ok: false, reason: "used" };
  if (row.expiresAt.getTime() < Date.now()) return { ok: false, reason: "expired" };

  return {
    ok: true,
    userId: row.userId,
    kind: (row.kind as SignupTokenKind) ?? "invite",
    userName: row.user.name,
    userEmail: row.user.email,
  };
}

export type ConsumeResult =
  | { ok: true; userId: string; userEmail: string }
  | { ok: false; reason: "missing" | "expired" | "used" | "weak" };

/**
 * Atomically validate the token, set the user's password hash, and
 * mark the token used. The "atomically" is via a Prisma transaction so
 * a crash mid-way never leaves a half-set password with a still-valid
 * token.
 *
 * `password` is validated minimally here (length floor + not the email
 * local part) — the UI is expected to enforce stricter rules with
 * feedback before posting.
 */
export async function consumeSignupToken(
  rawToken: string,
  password: string
): Promise<ConsumeResult> {
  if (typeof password !== "string" || password.length < 8) {
    return { ok: false, reason: "weak" };
  }

  const tokenHash = createHash("sha256").update(rawToken).digest("hex");
  if (signupTokenRateLimited(tokenHash)) {
    return { ok: false, reason: "missing" };
  }

  // Pre-flight check OUTSIDE the transaction so we can return a clean
  // failure code before doing the bcrypt hash.
  const existing = await db.signupToken.findUnique({
    where: { tokenHash },
    select: {
      id: true,
      userId: true,
      expiresAt: true,
      usedAt: true,
      user: { select: { email: true } },
    },
  });
  if (!existing) return { ok: false, reason: "missing" };
  if (existing.usedAt) return { ok: false, reason: "used" };
  if (existing.expiresAt.getTime() < Date.now()) {
    return { ok: false, reason: "expired" };
  }

  // Reject a password equal to the email local part ("alice" for
  // alice@example.com) — the most common weak choice that still clears
  // a pure length floor.
  const localPart = existing.user?.email.split("@")[0] ?? "";
  if (localPart && password.toLowerCase() === localPart.toLowerCase()) {
    return { ok: false, reason: "weak" };
  }

  const hashed = await hash(password, BCRYPT_COST);

  // The transaction guards a TOCTOU race: between the check above and
  // the update, another request could consume the same token. Using
  // updateMany with a `usedAt: null` filter means our update only
  // succeeds when the token is still unused. count===0 → someone beat
  // us to it; surface as "used".
  const claimed = await db.$transaction(async (tx) => {
    const update = await tx.signupToken.updateMany({
      where: {
        id: existing.id,
        usedAt: null,
        expiresAt: { gt: new Date() },
      },
      data: { usedAt: new Date() },
    });
    if (update.count === 0) return null;
    const user = await tx.user.update({
      where: { id: existing.userId },
      data: { hashedPassword: hashed, hasLoginAccess: true, isActive: true },
      select: { id: true, email: true },
    });
    return user;
  });

  if (!claimed) return { ok: false, reason: "used" };
  return { ok: true, userId: claimed.id, userEmail: claimed.email };
}

/**
 * Drop expired tokens. Called on a schedule (or could be wired into
 * the existing scheduled-tasks framework). Not load-bearing — even
 * without it, validation already rejects expired rows. This is
 * cleanup hygiene only.
 */
export async function pruneExpiredSignupTokens(): Promise<number> {
  const result = await db.signupToken.deleteMany({
    where: {
      OR: [
        { expiresAt: { lt: new Date() } },
        // Drop used tokens older than 30 days — kept around briefly so
        // an admin's audit log link to "the token used by X" still
        // resolves.
        { usedAt: { lt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } },
      ],
    },
  });
  return result.count;
}
