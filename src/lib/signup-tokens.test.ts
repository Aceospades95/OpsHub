import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the Prisma client + bcryptjs before importing the module under
// test so the module's static `import { db } from "@/lib/db"` and
// `import { hash } from "bcryptjs"` pick up the mocks.
vi.mock("@/lib/db", () => ({
  db: {
    signupToken: {
      upsert: vi.fn(),
      findUnique: vi.fn(),
      updateMany: vi.fn(),
      deleteMany: vi.fn(),
    },
    user: {
      update: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

vi.mock("bcryptjs", () => ({
  hash: vi.fn(async (password: string) => `hashed-${password}`),
}));

import { db } from "@/lib/db";
import { _testMemoryStorage } from "./rate-limit";
import {
  issueSignupToken,
  peekSignupToken,
  consumeSignupToken,
  pruneExpiredSignupTokens,
} from "./signup-tokens";

const upsert = db.signupToken.upsert as ReturnType<typeof vi.fn>;
const findUnique = db.signupToken.findUnique as ReturnType<typeof vi.fn>;
const updateMany = db.signupToken.updateMany as ReturnType<typeof vi.fn>;
const deleteMany = db.signupToken.deleteMany as ReturnType<typeof vi.fn>;
const userUpdate = db.user.update as ReturnType<typeof vi.fn>;
const transaction = db.$transaction as ReturnType<typeof vi.fn>;

describe("issueSignupToken", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    upsert.mockResolvedValue({ id: "tok-1" });
  });

  it("generates a 64-hex-char raw token, replacing any existing row", async () => {
    const result = await issueSignupToken("user-1", "invite");
    expect(result.rawToken).toMatch(/^[0-9a-f]{64}$/);
    expect(result.signupPath).toBe(`/signup/${result.rawToken}`);
    expect(result.expiresAt.getTime()).toBeGreaterThan(Date.now());
    // upsert (not create) so re-issuing replaces the prior token.
    expect(upsert).toHaveBeenCalledOnce();
    expect(upsert.mock.calls[0][0].where).toEqual({ userId: "user-1" });
  });

  it("never persists the raw token — only the SHA-256 hash", async () => {
    const result = await issueSignupToken("user-1", "invite");
    const args = upsert.mock.calls[0][0];
    expect(args.create.tokenHash).not.toBe(result.rawToken);
    expect(args.create.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(args.update.tokenHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("uses 'reset' kind when invoked for a password reset", async () => {
    await issueSignupToken("user-1", "reset");
    const args = upsert.mock.calls[0][0];
    expect(args.create.kind).toBe("reset");
    expect(args.update.kind).toBe("reset");
  });

  it("clears any prior usedAt so re-issued tokens start fresh", async () => {
    await issueSignupToken("user-1", "invite");
    const args = upsert.mock.calls[0][0];
    expect(args.update.usedAt).toBeNull();
  });
});

describe("peekSignupToken", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // The brute-force limiter shares one in-memory map per process —
    // start each test with fresh buckets.
    _testMemoryStorage.clear?.();
  });

  it("returns ok=true with kind + user info for a valid token", async () => {
    findUnique.mockResolvedValue({
      userId: "user-1",
      kind: "invite",
      expiresAt: new Date(Date.now() + 60_000),
      usedAt: null,
      user: { id: "user-1", name: "Alice", email: "alice@example.com" },
    });
    const result = await peekSignupToken("a".repeat(64));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.userId).toBe("user-1");
      expect(result.kind).toBe("invite");
      expect(result.userName).toBe("Alice");
      expect(result.userEmail).toBe("alice@example.com");
    }
  });

  it("returns 'missing' for an unknown token", async () => {
    findUnique.mockResolvedValue(null);
    const result = await peekSignupToken("nonsense");
    expect(result).toEqual({ ok: false, reason: "missing" });
  });

  it("returns 'used' for a previously-consumed token", async () => {
    findUnique.mockResolvedValue({
      userId: "user-1",
      kind: "invite",
      expiresAt: new Date(Date.now() + 60_000),
      usedAt: new Date(),
      user: { id: "user-1", name: "Alice", email: "alice@example.com" },
    });
    const result = await peekSignupToken("a".repeat(64));
    expect(result).toEqual({ ok: false, reason: "used" });
  });

  it("returns 'expired' for a stale token", async () => {
    findUnique.mockResolvedValue({
      userId: "user-1",
      kind: "invite",
      expiresAt: new Date(Date.now() - 60_000),
      usedAt: null,
      user: { id: "user-1", name: "Alice", email: "alice@example.com" },
    });
    const result = await peekSignupToken("a".repeat(64));
    expect(result).toEqual({ ok: false, reason: "expired" });
  });

  it("returns 'missing' for empty / non-string input", async () => {
    expect(await peekSignupToken("")).toEqual({ ok: false, reason: "missing" });
  });

  it("rate-limits repeated lookups of one token without leaking an oracle", async () => {
    findUnique.mockResolvedValue(null);
    // Per-token bucket holds 10; exhaust it.
    for (let i = 0; i < 10; i++) {
      expect(await peekSignupToken("b".repeat(64))).toEqual({
        ok: false,
        reason: "missing",
      });
    }
    expect(findUnique).toHaveBeenCalledTimes(10);
    // 11th attempt: same "missing" answer, but the DB is never touched.
    expect(await peekSignupToken("b".repeat(64))).toEqual({
      ok: false,
      reason: "missing",
    });
    expect(findUnique).toHaveBeenCalledTimes(10);
  });
});

describe("consumeSignupToken", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _testMemoryStorage.clear?.();
    transaction.mockImplementation(async (fn: (tx: unknown) => unknown) =>
      fn({
        signupToken: { updateMany },
        user: { update: userUpdate },
      })
    );
  });

  it("rejects passwords shorter than 8 chars without touching the DB", async () => {
    const result = await consumeSignupToken("a".repeat(64), "short");
    expect(result).toEqual({ ok: false, reason: "weak" });
    expect(findUnique).not.toHaveBeenCalled();
  });

  it("returns 'missing' when no token row matches", async () => {
    findUnique.mockResolvedValue(null);
    const result = await consumeSignupToken("a".repeat(64), "valid-pw-1234");
    expect(result).toEqual({ ok: false, reason: "missing" });
  });

  it("returns 'used' when the token has already been consumed", async () => {
    findUnique.mockResolvedValue({
      id: "tok-1",
      userId: "user-1",
      expiresAt: new Date(Date.now() + 60_000),
      usedAt: new Date(),
    });
    const result = await consumeSignupToken("a".repeat(64), "valid-pw-1234");
    expect(result).toEqual({ ok: false, reason: "used" });
  });

  it("returns 'expired' for a stale token", async () => {
    findUnique.mockResolvedValue({
      id: "tok-1",
      userId: "user-1",
      expiresAt: new Date(Date.now() - 60_000),
      usedAt: null,
    });
    const result = await consumeSignupToken("a".repeat(64), "valid-pw-1234");
    expect(result).toEqual({ ok: false, reason: "expired" });
  });

  it("sets the user's password + marks the token used atomically", async () => {
    findUnique.mockResolvedValue({
      id: "tok-1",
      userId: "user-1",
      expiresAt: new Date(Date.now() + 60_000),
      usedAt: null,
      user: { email: "alice@example.com" },
    });
    updateMany.mockResolvedValue({ count: 1 });
    userUpdate.mockResolvedValue({ id: "user-1", email: "alice@example.com" });

    const result = await consumeSignupToken("a".repeat(64), "valid-pw-1234");
    expect(result).toEqual({
      ok: true,
      userId: "user-1",
      userEmail: "alice@example.com",
    });
    // user.update is called with hashedPassword set + hasLoginAccess re-asserted
    expect(userUpdate).toHaveBeenCalledOnce();
    const args = userUpdate.mock.calls[0][0];
    expect(args.where).toEqual({ id: "user-1" });
    expect(args.data.hashedPassword).toMatch(/^hashed-/);
    expect(args.data.hasLoginAccess).toBe(true);
    expect(args.data.isActive).toBe(true);
  });

  it("returns 'used' when the TOCTOU race leaves count=0", async () => {
    findUnique.mockResolvedValue({
      id: "tok-1",
      userId: "user-1",
      expiresAt: new Date(Date.now() + 60_000),
      usedAt: null,
      user: { email: "alice@example.com" },
    });
    // Simulate a concurrent caller having already claimed the token.
    updateMany.mockResolvedValue({ count: 0 });

    const result = await consumeSignupToken("a".repeat(64), "valid-pw-1234");
    expect(result).toEqual({ ok: false, reason: "used" });
    expect(userUpdate).not.toHaveBeenCalled();
  });

  it("rejects a password equal to the email local part (case-insensitive)", async () => {
    findUnique.mockResolvedValue({
      id: "tok-1",
      userId: "user-1",
      expiresAt: new Date(Date.now() + 60_000),
      usedAt: null,
      user: { email: "christopher@example.com" },
    });

    expect(await consumeSignupToken("a".repeat(64), "christopher")).toEqual({
      ok: false,
      reason: "weak",
    });
    expect(await consumeSignupToken("a".repeat(64), "ChRiStOpHeR")).toEqual({
      ok: false,
      reason: "weak",
    });
    // Token never gets consumed for a weak password.
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("rate-limits repeated consume attempts of one token like an invalid token", async () => {
    findUnique.mockResolvedValue(null);
    for (let i = 0; i < 10; i++) {
      expect(await consumeSignupToken("c".repeat(64), "valid-pw-1234")).toEqual(
        { ok: false, reason: "missing" }
      );
    }
    expect(findUnique).toHaveBeenCalledTimes(10);
    // 11th attempt: same "missing" answer, but the DB is never touched.
    expect(await consumeSignupToken("c".repeat(64), "valid-pw-1234")).toEqual({
      ok: false,
      reason: "missing",
    });
    expect(findUnique).toHaveBeenCalledTimes(10);
  });
});

describe("pruneExpiredSignupTokens", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("deletes expired and old-used tokens and returns the count", async () => {
    deleteMany.mockResolvedValue({ count: 7 });
    const removed = await pruneExpiredSignupTokens();
    expect(removed).toBe(7);
    const args = deleteMany.mock.calls[0][0];
    expect(args.where.OR).toHaveLength(2);
  });
});
