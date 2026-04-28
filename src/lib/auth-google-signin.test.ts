/**
 * Tests for the Google sign-in auto-link helper.
 *
 * The 9 scenarios mirror the spec the auth fix shipped against:
 *   1. Pre-provisioned User + verified email + first SSO  → Account linked
 *   2. Pre-provisioned User + UNVERIFIED email             → rejected
 *   3. Pre-provisioned + hasLoginAccess: false             → rejected
 *   4. New email + verified                                → User+Account created
 *   5. Already-linked Google identity returns              → no new rows
 *   6. Both auth methods, password sign-in                 → unchanged (covered separately)
 *   7. Both methods, Google sign-in                        → re-link or pass-through, no DB writes to User
 *   8. Case-insensitive email match                        → links to existing User
 *   9. Two Users with same email                           → rejected, error logged
 *
 * Scenario 6 (password sign-in) doesn't go through this helper — the
 * Credentials provider's authorize() handles it. We assert here only
 * that the Google path leaves hashedPassword untouched.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Account, Profile, User as NextAuthUser } from "next-auth";

import { handleGoogleSignIn } from "./auth-google-signin";

// ─── Test scaffold ─────────────────────────────────────────────

type DbDouble = {
  account: {
    findUnique: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
  };
  user: {
    findMany: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  allowedDomain: {
    findMany: ReturnType<typeof vi.fn>;
  };
};

function newDb(): DbDouble {
  return {
    account: {
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({}),
    },
    user: {
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({}),
      update: vi.fn().mockResolvedValue({}),
    },
    allowedDomain: {
      findMany: vi.fn().mockResolvedValue([]),
    },
  };
}

const baseAccount = {
  provider: "google",
  type: "oauth",
  providerAccountId: "google-oauth-id-123",
  access_token: "at",
  id_token: "it",
  refresh_token: "rt",
  expires_at: 1234567890,
  token_type: "Bearer",
  scope: "openid email profile",
} as unknown as Account;

const baseUser = {
  id: "google-uid",
  name: "Jane Doe",
  email: "jane@wynndalco.com",
  image: "https://example.com/jane.jpg",
  // role is part of the module-augmented next-auth User type but isn't
  // populated until the JWT/session callback — set a placeholder so
  // tests typecheck.
  role: "GUEST",
} as unknown as NextAuthUser;

const verifiedProfile = (email: string): Profile =>
  ({
    email,
    email_verified: true,
    name: "Jane Doe",
  }) as unknown as Profile;

const unverifiedProfile = (email: string): Profile =>
  ({
    email,
    email_verified: false,
    name: "Jane Doe",
  }) as unknown as Profile;

// Cast helper to call the helper without a real Prisma client type.
async function call(
  db: DbDouble,
  input: {
    user?: NextAuthUser;
    account?: Account | null;
    profile?: Profile;
  },
  log?: (msg: string) => void
) {
  return handleGoogleSignIn(
    {
      user: input.user ?? baseUser,
      account: input.account ?? baseAccount,
      profile: input.profile ?? verifiedProfile(baseUser.email!),
    },
    {
      db: db as unknown as Parameters<typeof handleGoogleSignIn>[1]["db"],
      log,
    }
  );
}

// ─── Scenarios ─────────────────────────────────────────────────

describe("handleGoogleSignIn", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("(1) pre-provisioned user + verified email: links Account, preserves user row", async () => {
    const db = newDb();
    const preProvisioned = {
      id: "user-pre",
      email: "jane@wynndalco.com",
      role: "ADMIN",
      isActive: true,
      hasLoginAccess: true,
      avatar: null,
      hashedPassword: null,
      authProvider: "credentials",
    };
    db.user.findMany.mockResolvedValueOnce([preProvisioned]);

    const out = await call(db, {});

    expect(out).toBe(true);
    expect(db.account.create).toHaveBeenCalledTimes(1);
    expect(db.account.create.mock.calls[0][0].data).toMatchObject({
      userId: "user-pre",
      provider: "google",
      providerAccountId: "google-oauth-id-123",
    });
    // No new User row: only the avatar update is allowed and it sets avatar (not role/permissions).
    expect(db.user.create).not.toHaveBeenCalled();
    // Avatar was null, so the helper updates it from the Google profile.
    expect(db.user.update).toHaveBeenCalledWith({
      where: { id: "user-pre" },
      data: { avatar: baseUser.image },
    });
  });

  it("(2) unverified email: rejected with EmailNotVerified, no DB writes", async () => {
    const db = newDb();
    const out = await call(db, {
      profile: unverifiedProfile(baseUser.email!),
    });

    expect(out).toBe("/login?error=EmailNotVerified");
    expect(db.user.findMany).not.toHaveBeenCalled();
    expect(db.account.create).not.toHaveBeenCalled();
    expect(db.user.create).not.toHaveBeenCalled();
    expect(db.user.update).not.toHaveBeenCalled();
  });

  it("(3) pre-provisioned user with hasLoginAccess: false: rejected, no Account created", async () => {
    const db = newDb();
    db.user.findMany.mockResolvedValueOnce([
      {
        id: "user-disabled",
        email: "jane@wynndalco.com",
        role: "ADMIN",
        isActive: true,
        hasLoginAccess: false,
        avatar: null,
      },
    ]);

    const out = await call(db, {});

    expect(out).toBe("/login?error=Disabled");
    expect(db.account.create).not.toHaveBeenCalled();
    expect(db.user.create).not.toHaveBeenCalled();
  });

  it("(4) new email, no matching user: creates User (GUEST) + Account", async () => {
    const db = newDb();
    db.user.findMany.mockResolvedValueOnce([]);
    db.user.create.mockResolvedValueOnce({ id: "user-new" });

    const out = await call(db, {});

    expect(out).toBe(true);
    expect(db.user.create).toHaveBeenCalledTimes(1);
    expect(db.user.create.mock.calls[0][0].data).toMatchObject({
      email: "jane@wynndalco.com",
      role: "GUEST",
      authProvider: "google",
    });
    expect(db.account.create).toHaveBeenCalledTimes(1);
    expect(db.account.create.mock.calls[0][0].data).toMatchObject({
      userId: "user-new",
      provider: "google",
    });
  });

  it("(5) already-linked Google identity: passes through with no new rows", async () => {
    const db = newDb();
    db.account.findUnique.mockResolvedValueOnce({
      id: "acct-1",
      userId: "user-existing",
      provider: "google",
      providerAccountId: baseAccount.providerAccountId,
      user: {
        id: "user-existing",
        email: "jane@wynndalco.com",
        isActive: true,
        hasLoginAccess: true,
        avatar: "/already-set.png",
      },
    });

    const out = await call(db, {});

    expect(out).toBe(true);
    expect(db.user.findMany).not.toHaveBeenCalled();
    expect(db.account.create).not.toHaveBeenCalled();
    expect(db.user.create).not.toHaveBeenCalled();
    expect(db.user.update).not.toHaveBeenCalled();
  });

  it("(7) user with both auth methods, Google sign-in: hashedPassword unaffected", async () => {
    const db = newDb();
    db.user.findMany.mockResolvedValueOnce([
      {
        id: "user-both",
        email: "jane@wynndalco.com",
        role: "MANAGER",
        isActive: true,
        hasLoginAccess: true,
        avatar: "/already.png",
        hashedPassword: "$2a$12$...",
        authProvider: "credentials",
      },
    ]);

    const out = await call(db, {});

    expect(out).toBe(true);
    expect(db.account.create).toHaveBeenCalledTimes(1);
    // The only allowed user.update path is avatar fill, and avatar
    // was already set, so we shouldn't touch the user row at all.
    expect(db.user.update).not.toHaveBeenCalled();
    // Critically: no update touches hashedPassword or authProvider.
    const updateCalls = db.user.update.mock.calls;
    for (const c of updateCalls) {
      expect(c[0]).not.toHaveProperty("data.hashedPassword");
      expect(c[0]).not.toHaveProperty("data.authProvider");
    }
  });

  it("(8) case-insensitive match: 'Jane@Wynndalco.com' pre-provisioned, Google returns 'jane@wynndalco.com'", async () => {
    const db = newDb();
    db.user.findMany.mockResolvedValueOnce([
      {
        id: "user-mixed-case",
        email: "Jane@Wynndalco.com",
        role: "ADMIN",
        isActive: true,
        hasLoginAccess: true,
        avatar: null,
      },
    ]);

    const out = await call(db, {});

    expect(out).toBe(true);
    // Confirm the where clause was passed in insensitive mode with the
    // already-lowercased email.
    expect(db.user.findMany).toHaveBeenCalledTimes(1);
    expect(db.user.findMany.mock.calls[0][0]).toMatchObject({
      where: { email: { equals: "jane@wynndalco.com", mode: "insensitive" } },
      take: 2,
    });
    expect(db.account.create).toHaveBeenCalledTimes(1);
    expect(db.account.create.mock.calls[0][0].data.userId).toBe("user-mixed-case");
  });

  it("(9) two users with the same email: rejected, error logged", async () => {
    const db = newDb();
    db.user.findMany.mockResolvedValueOnce([
      {
        id: "user-dup-1",
        email: "jane@wynndalco.com",
        role: "ADMIN",
        isActive: true,
        hasLoginAccess: true,
        avatar: null,
      },
      {
        id: "user-dup-2",
        email: "Jane@wynndalco.com",
        role: "GUEST",
        isActive: true,
        hasLoginAccess: true,
        avatar: null,
      },
    ]);
    const log = vi.fn();

    const out = await call(db, {}, log);

    expect(out).toBe("/login?error=DuplicateEmail");
    expect(db.account.create).not.toHaveBeenCalled();
    expect(db.user.create).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0][0]).toContain("2 User rows match");
  });

  it("domain allowlist: rejects when domain isn't on the list", async () => {
    const db = newDb();
    db.allowedDomain.findMany.mockResolvedValueOnce([
      { id: "1", domain: "company.com", createdAt: new Date() },
    ]);

    const out = await call(db, {});

    expect(out).toBe("/login?error=DomainNotAllowed");
    expect(db.user.findMany).not.toHaveBeenCalled();
    expect(db.account.create).not.toHaveBeenCalled();
  });

  it("non-Google providers fall through to true (Credentials path)", async () => {
    const db = newDb();
    const out = await handleGoogleSignIn(
      {
        user: baseUser,
        account: { ...baseAccount, provider: "credentials" } as Account,
        profile: undefined,
      },
      { db: db as unknown as Parameters<typeof handleGoogleSignIn>[1]["db"] }
    );
    expect(out).toBe(true);
    expect(db.user.findMany).not.toHaveBeenCalled();
  });
});
