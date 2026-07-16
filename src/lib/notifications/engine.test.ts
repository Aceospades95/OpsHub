/**
 * Permutation tests for the notification engine (`notify()` in ./index.ts).
 *
 * Every test documents what the engine ACTUALLY does — rule gates,
 * throttling, recipient expansion, per-user mutes, template substitution,
 * extraEmails, and failure semantics — with the database, email layer,
 * logger, and Next cache all mocked. No real database is touched.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock Prisma, the email layer, the logger, and next/cache before importing
// the module under test so its static imports pick up the mocks.
vi.mock("@/lib/db", () => ({
  db: {
    notificationRule: { findUnique: vi.fn() },
    notification: { findFirst: vi.fn(), createManyAndReturn: vi.fn() },
    user: { findMany: vi.fn() },
    userNotificationPref: { findMany: vi.fn() },
  },
}));
vi.mock("@/lib/email", () => ({
  sendFromTemplate: vi.fn(),
}));
vi.mock("@/lib/log", () => ({
  log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

import { db } from "@/lib/db";
import { log } from "@/lib/log";
import { sendFromTemplate, type TemplateDataMap } from "@/lib/email";
import { revalidatePath } from "next/cache";
import type { NotificationRule } from "@prisma/client";
import { notify } from "./index";
import type { NotificationType } from "./types";

const ruleFindUnique = db.notificationRule.findUnique as ReturnType<typeof vi.fn>;
const notifFindFirst = db.notification.findFirst as ReturnType<typeof vi.fn>;
const createManyAndReturn = db.notification
  .createManyAndReturn as unknown as ReturnType<typeof vi.fn>;
const userFindMany = db.user.findMany as ReturnType<typeof vi.fn>;
const prefFindMany = db.userNotificationPref.findMany as ReturnType<typeof vi.fn>;
const mockedSend = sendFromTemplate as unknown as ReturnType<typeof vi.fn>;
const mockedRevalidate = revalidatePath as unknown as ReturnType<typeof vi.fn>;
const mockedLogError = log.error as unknown as ReturnType<typeof vi.fn>;

// ─── Fixtures ────────────────────────────────────────────────────────

interface DirectoryUser {
  id: string;
  name: string;
  email: string;
  role: string;
  isActive: boolean;
  hasLoginAccess: boolean;
}

function user(id: string, overrides: Partial<DirectoryUser> = {}): DirectoryUser {
  return {
    id,
    name: `Name of ${id}`,
    email: `${id}@example.com`,
    role: "CONTRIBUTOR",
    isActive: true,
    hasLoginAccess: true,
    ...overrides,
  };
}

const alice = user("u-alice", { name: "Alice", email: "alice@example.com" });
const bob = user("u-bob", { name: "Bob", email: "bob@example.com" });
const ada = user("u-ada", { name: "Ada", email: "ada@example.com", role: "ADMIN" });
const idleAdmin = user("u-idle", { name: "Idle", role: "ADMIN", isActive: false });
const max = user("u-max", { name: "Max", email: "max@example.com", role: "MANAGER" });
const ned = user("u-ned", { name: "Ned", email: "ned@example.com", hasLoginAccess: false });
const CAST = [alice, bob, ada, idleAdmin, max, ned];

function rule(overrides: Partial<NotificationRule> = {}): NotificationRule {
  return {
    id: "rule-1",
    typeKey: "task-assigned",
    enabled: true,
    channelInApp: true,
    channelEmail: true,
    recipientRoles: [],
    recipientUserIds: [],
    extraEmails: [],
    subjectTemplate: null,
    bodyTemplate: null,
    throttleHours: null,
    createdAt: new Date("2026-07-01T00:00:00Z"),
    updatedAt: new Date("2026-07-01T00:00:00Z"),
    ...overrides,
  };
}

/**
 * Wire user.findMany to an in-memory directory. The engine issues two
 * different user queries:
 *   1. role expansion — `{ where: { isActive: true }, select: { id, role } }`
 *   2. candidate resolution — `{ where: { id: { in }, isActive: true }, ... }`
 * We discriminate on the presence of `where.id`.
 */
function seedUsers(users: DirectoryUser[]) {
  userFindMany.mockImplementation(
    async (args: { where?: { id?: { in: string[] } } } = {}) => {
      const idFilter = args.where?.id?.in;
      if (idFilter) {
        return users
          .filter((u) => idFilter.includes(u.id) && u.isActive)
          .map(({ id, name, email, hasLoginAccess }) => ({ id, name, email, hasLoginAccess }));
      }
      return users.filter((u) => u.isActive).map(({ id, role }) => ({ id, role }));
    }
  );
}

interface PrefRow {
  userId: string;
  typeKey: string;
  muteInApp?: boolean;
  muteEmail?: boolean;
}

function seedPrefs(rows: PrefRow[]) {
  prefFindMany.mockImplementation(
    async (args: { where: { typeKey: string; userId: { in: string[] } } }) =>
      rows
        .filter(
          (r) => r.typeKey === args.where.typeKey && args.where.userId.in.includes(r.userId)
        )
        .map((r, i) => ({
          id: `pref-${i}`,
          userId: r.userId,
          typeKey: r.typeKey,
          muteInApp: r.muteInApp ?? false,
          muteEmail: r.muteEmail ?? false,
          updatedAt: new Date(),
        }))
  );
}

const base = {
  recipientId: "u-alice" as string | string[],
  type: "task-assigned" as NotificationType,
  title: "You were assigned a task",
  body: "Fix the door",
  href: "/tasks#t-1",
  entityType: "task",
  entityId: "t-1",
  actorId: "u-actor",
};

function genericEmail() {
  return {
    templateKey: "notification" as const,
    data: {
      recipientName: "Placeholder",
      heading: "Caller heading",
      body: "Caller email body",
      cta: { label: "Open task", url: "https://ops.example.com/tasks#t-1" },
    },
  };
}

// ─── Assertion helpers ───────────────────────────────────────────────

function createdRows(): Array<Record<string, unknown>> {
  return createManyAndReturn.mock.calls.flatMap(
    (c) => (c[0] as { data: Array<Record<string, unknown>> }).data
  );
}
function createdRecipients(): string[] {
  return createdRows().map((r) => r.recipientId as string);
}
function sentTo(): string[] {
  return mockedSend.mock.calls.map((c) => (c[2] as { to: string }).to);
}
function sentData(i: number): Record<string, unknown> {
  return mockedSend.mock.calls[i][1] as Record<string, unknown>;
}
function sentOptions(i: number): Record<string, unknown> {
  return mockedSend.mock.calls[i][2] as Record<string, unknown>;
}

beforeEach(() => {
  vi.clearAllMocks();
  // Defaults: no rule row, no throttle hit, full active cast, no prefs,
  // happy email driver. Tests override what they need; every mock's
  // implementation is re-established here so nothing leaks between tests.
  ruleFindUnique.mockResolvedValue(null);
  notifFindFirst.mockResolvedValue(null);
  createManyAndReturn.mockImplementation(
    async ({ data }: { data: Array<Record<string, unknown>> }) =>
      data.map((d, i) => ({ id: `n-${i}`, readAt: null, ...d }))
  );
  seedUsers(CAST);
  seedPrefs([]);
  mockedSend.mockResolvedValue({ success: true, driver: "mock", messageId: "m-1" });
});

// ─── 1. Rule resolution × channel gates ──────────────────────────────

describe("rule resolution × channel gates", () => {
  const cases: Array<{
    label: string;
    ruleRow: NotificationRule | null;
    inApp: boolean;
    email: boolean;
  }> = [
    { label: "no rule row → stock: in-app + email", ruleRow: null, inApp: true, email: true },
    {
      label: "rule disabled → nothing on either channel",
      ruleRow: rule({ enabled: false }),
      inApp: false,
      email: false,
    },
    { label: "rule enabled, both channels on", ruleRow: rule(), inApp: true, email: true },
    {
      label: "channelEmail=false → in-app only",
      ruleRow: rule({ channelEmail: false }),
      inApp: true,
      email: false,
    },
    {
      label: "channelInApp=false → email only",
      ruleRow: rule({ channelInApp: false }),
      inApp: false,
      email: true,
    },
    {
      label: "both channels off → neither",
      ruleRow: rule({ channelInApp: false, channelEmail: false }),
      inApp: false,
      email: false,
    },
  ];

  it.each(cases)("$label", async ({ ruleRow, inApp, email }) => {
    ruleFindUnique.mockResolvedValue(ruleRow);

    const created = await notify({ ...base, email: genericEmail() });

    if (inApp) {
      expect(createManyAndReturn).toHaveBeenCalledTimes(1);
      expect(createdRecipients()).toEqual(["u-alice"]);
      expect(created).toHaveLength(1);
    } else {
      expect(createManyAndReturn).not.toHaveBeenCalled();
      expect(created).toEqual([]);
    }
    if (email) {
      expect(mockedSend).toHaveBeenCalledTimes(1);
      expect(sentTo()).toEqual(["alice@example.com"]);
    } else {
      expect(mockedSend).not.toHaveBeenCalled();
    }
  });

  it("treats a rule-lookup failure as no rule (stock behavior) and logs it", async () => {
    const boom = new Error("db down");
    ruleFindUnique.mockRejectedValue(boom);

    const created = await notify({ ...base, email: genericEmail() });

    expect(created).toHaveLength(1);
    expect(sentTo()).toEqual(["alice@example.com"]);
    expect(mockedLogError).toHaveBeenCalledWith(
      "notifications.rules",
      "Rule lookup failed",
      boom,
      { type: "task-assigned" }
    );
  });

  it("a disabled rule short-circuits before throttle and recipient queries", async () => {
    ruleFindUnique.mockResolvedValue(rule({ enabled: false, throttleHours: 24 }));

    await notify({ ...base, email: genericEmail() });

    expect(notifFindFirst).not.toHaveBeenCalled();
    expect(userFindMany).not.toHaveBeenCalled();
    expect(prefFindMany).not.toHaveBeenCalled();
  });

  it("no caller email block → no emails even when the email channel is open", async () => {
    ruleFindUnique.mockResolvedValue(rule({ channelEmail: true }));

    const created = await notify({ ...base });

    expect(created).toHaveLength(1);
    expect(mockedSend).not.toHaveBeenCalled();
  });

  it("sends with the caller's template key and audit context", async () => {
    await notify({ ...base, email: genericEmail() });

    expect(mockedSend.mock.calls[0][0]).toBe("notification");
    expect(sentOptions(0)).toEqual({
      to: "alice@example.com",
      entityType: "task",
      entityId: "t-1",
    });
  });
});

// ─── 2. Throttling ───────────────────────────────────────────────────

describe("throttling", () => {
  it("suppresses both channels when a recent same-type+entity notification exists", async () => {
    ruleFindUnique.mockResolvedValue(rule({ throttleHours: 24 }));
    notifFindFirst.mockResolvedValue({ id: "n-old" });
    const before = Date.now();

    const created = await notify({ ...base, email: genericEmail() });

    expect(created).toEqual([]);
    expect(createManyAndReturn).not.toHaveBeenCalled();
    expect(mockedSend).not.toHaveBeenCalled();
    // Suppression happens before recipient expansion — no user queries.
    expect(userFindMany).not.toHaveBeenCalled();

    // Exact where shape: type + entityId + window only. Notably there is
    // NO recipientId filter — the throttle is global across recipients.
    expect(notifFindFirst).toHaveBeenCalledWith({
      where: {
        type: "task-assigned",
        entityId: "t-1",
        createdAt: { gte: expect.any(Date) },
      },
      select: { id: true },
    });
    const gte = (notifFindFirst.mock.calls[0][0].where.createdAt as { gte: Date }).gte;
    expect(gte.getTime()).toBeGreaterThanOrEqual(before - 24 * 3600_000);
    expect(gte.getTime()).toBeLessThanOrEqual(Date.now() - 24 * 3600_000);
  });

  it("proceeds normally when nothing recent matches", async () => {
    ruleFindUnique.mockResolvedValue(rule({ throttleHours: 24 }));
    notifFindFirst.mockResolvedValue(null);

    const created = await notify({ ...base, email: genericEmail() });

    expect(created).toHaveLength(1);
    expect(sentTo()).toEqual(["alice@example.com"]);
  });

  const noThrottleCases = [
    { label: "throttleHours null", ruleRow: rule({ throttleHours: null }), params: base },
    // 0 is falsy, so a zero-hour throttle is treated as "no throttle".
    { label: "throttleHours 0", ruleRow: rule({ throttleHours: 0 }), params: base },
    {
      label: "no entityId on the notification",
      ruleRow: rule({ throttleHours: 24 }),
      params: { ...base, entityId: undefined },
    },
    {
      label: "empty-string entityId (falsy)",
      ruleRow: rule({ throttleHours: 24 }),
      params: { ...base, entityId: "" },
    },
  ];

  it.each(noThrottleCases)(
    "never checks the throttle window when $label",
    async ({ ruleRow, params }) => {
      ruleFindUnique.mockResolvedValue(ruleRow);

      const created = await notify({ ...params, email: genericEmail() });

      expect(notifFindFirst).not.toHaveBeenCalled();
      expect(created).toHaveLength(1);
      expect(mockedSend).toHaveBeenCalledTimes(1);
    }
  );

  it("throttles per entity — a different entityId is not suppressed", async () => {
    ruleFindUnique.mockResolvedValue(rule({ throttleHours: 24 }));
    notifFindFirst.mockImplementation(
      async (args: { where: { entityId: string } }) =>
        args.where.entityId === "t-hot" ? { id: "n-old" } : null
    );

    const cold = await notify({ ...base, entityId: "t-cold", email: genericEmail() });
    expect(cold).toHaveLength(1);
    expect(createManyAndReturn).toHaveBeenCalledTimes(1);

    const hot = await notify({ ...base, entityId: "t-hot", email: genericEmail() });
    expect(hot).toEqual([]);
    expect(createManyAndReturn).toHaveBeenCalledTimes(1); // unchanged
    expect(mockedSend).toHaveBeenCalledTimes(1); // only the cold send
  });

  it("a prior notification older than the window does not suppress", async () => {
    const threeHoursAgo = new Date(Date.now() - 3 * 3600_000);
    notifFindFirst.mockImplementation(
      async (args: { where: { createdAt: { gte: Date } } }) =>
        threeHoursAgo >= args.where.createdAt.gte ? { id: "n-old" } : null
    );

    // 2h window: the 3h-old row is outside → delivery proceeds.
    ruleFindUnique.mockResolvedValue(rule({ throttleHours: 2 }));
    const outside = await notify({ ...base, email: genericEmail() });
    expect(outside).toHaveLength(1);

    // 4h window: the same row is inside → suppressed.
    ruleFindUnique.mockResolvedValue(rule({ throttleHours: 4 }));
    const inside = await notify({ ...base, email: genericEmail() });
    expect(inside).toEqual([]);
    expect(createManyAndReturn).toHaveBeenCalledTimes(1);
  });

  it("throttling applies even with suppressRuleRecipients", async () => {
    ruleFindUnique.mockResolvedValue(rule({ throttleHours: 24 }));
    notifFindFirst.mockResolvedValue({ id: "n-old" });

    const created = await notify({
      ...base,
      suppressRuleRecipients: true,
      email: genericEmail(),
    });

    expect(created).toEqual([]);
    expect(createManyAndReturn).not.toHaveBeenCalled();
  });
});

// ─── 3. Recipient expansion ──────────────────────────────────────────

describe("recipient expansion", () => {
  it("recipientRoles add every ACTIVE user holding one of the roles", async () => {
    // Cast holds ada (active ADMIN) and idleAdmin (inactive ADMIN).
    ruleFindUnique.mockResolvedValue(rule({ recipientRoles: ["ADMIN"] }));

    const created = await notify({ ...base, email: genericEmail() });

    expect(createdRecipients().sort()).toEqual(["u-ada", "u-alice"]);
    expect(created).toHaveLength(2);
    expect(sentTo().sort()).toEqual(["ada@example.com", "alice@example.com"]);
  });

  it("role matching happens in JS over all active users (query does not filter by role)", async () => {
    ruleFindUnique.mockResolvedValue(rule({ recipientRoles: ["ADMIN"] }));

    await notify({ ...base });

    // First user query is the role scan: active-only, id+role select.
    expect(userFindMany.mock.calls[0][0]).toEqual({
      where: { isActive: true },
      select: { id: true, role: true },
    });
    // Second is candidate resolution by id, active-only.
    expect(userFindMany.mock.calls[1][0].where.isActive).toBe(true);
    expect(userFindMany.mock.calls[1][0].where.id.in.sort()).toEqual(["u-ada", "u-alice"]);
  });

  it("supports multiple roles at once", async () => {
    ruleFindUnique.mockResolvedValue(rule({ recipientRoles: ["ADMIN", "MANAGER"] }));

    await notify({ ...base });

    expect(createdRecipients().sort()).toEqual(["u-ada", "u-alice", "u-max"]);
  });

  it("skips the role scan entirely when the rule adds no roles", async () => {
    ruleFindUnique.mockResolvedValue(rule());

    await notify({ ...base });

    expect(userFindMany).toHaveBeenCalledTimes(1);
    expect(userFindMany.mock.calls[0][0].where.id.in).toEqual(["u-alice"]);
  });

  it("recipientUserIds are added to the caller's recipients", async () => {
    ruleFindUnique.mockResolvedValue(rule({ recipientUserIds: ["u-bob"] }));

    const created = await notify({ ...base, email: genericEmail() });

    expect(createdRecipients().sort()).toEqual(["u-alice", "u-bob"]);
    expect(created).toHaveLength(2);
    expect(sentTo().sort()).toEqual(["alice@example.com", "bob@example.com"]);
  });

  it("unknown or inactive recipientUserIds are dropped by active-user resolution", async () => {
    ruleFindUnique.mockResolvedValue(rule({ recipientUserIds: ["u-idle", "u-ghost"] }));

    const created = await notify({ ...base, email: genericEmail() });

    expect(createdRecipients()).toEqual(["u-alice"]);
    expect(created).toHaveLength(1);
    expect(sentTo()).toEqual(["alice@example.com"]);
  });

  it("a user matching role + explicit id + direct recipient is delivered exactly once", async () => {
    seedUsers([alice, ada]); // only alice is a CONTRIBUTOR
    ruleFindUnique.mockResolvedValue(
      rule({ recipientRoles: ["CONTRIBUTOR"], recipientUserIds: ["u-alice"] })
    );

    const created = await notify({ ...base, email: genericEmail() });

    expect(createdRecipients()).toEqual(["u-alice"]);
    expect(created).toHaveLength(1);
    expect(mockedSend).toHaveBeenCalledTimes(1);
  });

  it("broadcast: an array of recipientIds gets one row per recipient", async () => {
    const created = await notify({
      ...base,
      recipientId: ["u-alice", "u-bob"],
      email: genericEmail(),
    });

    expect(createdRecipients().sort()).toEqual(["u-alice", "u-bob"]);
    expect(created).toHaveLength(2);
    expect(mockedSend).toHaveBeenCalledTimes(2);
  });

  it("duplicate ids in the recipientId array collapse to one delivery", async () => {
    const created = await notify({
      ...base,
      recipientId: ["u-alice", "u-alice"],
      email: genericEmail(),
    });

    expect(createdRecipients()).toEqual(["u-alice"]);
    expect(created).toHaveLength(1);
    expect(mockedSend).toHaveBeenCalledTimes(1);
  });

  it("an inactive direct recipient resolves to nothing", async () => {
    const created = await notify({
      ...base,
      recipientId: "u-idle",
      email: genericEmail(),
    });

    expect(created).toEqual([]);
    expect(createManyAndReturn).not.toHaveBeenCalled();
    expect(mockedSend).not.toHaveBeenCalled();
    // No resolved users → the prefs query is skipped too.
    expect(prefFindMany).not.toHaveBeenCalled();
  });

  it("a no-login user still gets the in-app row but never an email", async () => {
    const created = await notify({
      ...base,
      recipientId: "u-ned",
      email: genericEmail(),
    });

    expect(createdRecipients()).toEqual(["u-ned"]);
    expect(created).toHaveLength(1);
    expect(mockedSend).not.toHaveBeenCalled();
  });

  it("empty recipient list with no rule sends nothing and skips all user queries", async () => {
    const created = await notify({ ...base, recipientId: [], email: genericEmail() });

    expect(created).toEqual([]);
    expect(userFindMany).not.toHaveBeenCalled();
    expect(createManyAndReturn).not.toHaveBeenCalled();
    expect(mockedSend).not.toHaveBeenCalled();
  });

  it("empty recipient list + rule extraEmails → no rows, but extras still get a copy", async () => {
    ruleFindUnique.mockResolvedValue(rule({ extraEmails: ["ops@example.com"] }));

    const created = await notify({ ...base, recipientId: [], email: genericEmail() });

    expect(created).toEqual([]);
    expect(createManyAndReturn).not.toHaveBeenCalled();
    expect(sentTo()).toEqual(["ops@example.com"]);
    expect(sentData(0).recipientName).toBe("team");
  });

  it("an inactive direct recipient + rule extraEmails → extras still emailed", async () => {
    ruleFindUnique.mockResolvedValue(rule({ extraEmails: ["ops@example.com"] }));

    const created = await notify({
      ...base,
      recipientId: "u-idle",
      email: genericEmail(),
    });

    expect(created).toEqual([]);
    expect(sentTo()).toEqual(["ops@example.com"]);
  });
});

// ─── 4. suppressRuleRecipients ───────────────────────────────────────

describe("suppressRuleRecipients", () => {
  const fullRule = (overrides: Partial<NotificationRule> = {}) =>
    rule({
      recipientRoles: ["ADMIN"],
      recipientUserIds: ["u-bob"],
      extraEmails: ["ops@example.com"],
      ...overrides,
    });

  it("ignores rule-added roles, users, and extraEmails — direct recipient only", async () => {
    ruleFindUnique.mockResolvedValue(fullRule());

    const created = await notify({
      ...base,
      suppressRuleRecipients: true,
      email: genericEmail(),
    });

    expect(createdRecipients()).toEqual(["u-alice"]);
    expect(created).toHaveLength(1);
    expect(sentTo()).toEqual(["alice@example.com"]);
    // The role scan is skipped entirely — one user query, by id.
    expect(userFindMany).toHaveBeenCalledTimes(1);
    expect(userFindMany.mock.calls[0][0].where.id.in).toEqual(["u-alice"]);
  });

  it("still honors the enabled kill switch", async () => {
    ruleFindUnique.mockResolvedValue(fullRule({ enabled: false }));

    const created = await notify({
      ...base,
      suppressRuleRecipients: true,
      email: genericEmail(),
    });

    expect(created).toEqual([]);
    expect(mockedSend).not.toHaveBeenCalled();
  });

  it("still honors channel gates", async () => {
    ruleFindUnique.mockResolvedValue(fullRule({ channelInApp: false }));

    const created = await notify({
      ...base,
      suppressRuleRecipients: true,
      email: genericEmail(),
    });

    expect(created).toEqual([]);
    expect(createManyAndReturn).not.toHaveBeenCalled();
    expect(sentTo()).toEqual(["alice@example.com"]);
  });

  it("still applies the rule's email templates", async () => {
    ruleFindUnique.mockResolvedValue(fullRule({ subjectTemplate: "S {{recipientName}}" }));

    await notify({ ...base, suppressRuleRecipients: true, email: genericEmail() });

    expect(sentData(0).heading).toBe("S Alice");
  });
});

// ─── 5. Per-user preference mutes ────────────────────────────────────

describe("per-user preference mutes", () => {
  const matrix: Array<{
    label: string;
    pref: { muteInApp: boolean; muteEmail: boolean } | null;
    row: boolean;
    email: boolean;
  }> = [
    { label: "no pref row → both channels deliver", pref: null, row: true, email: true },
    {
      label: "muteInApp only → email still delivers",
      pref: { muteInApp: true, muteEmail: false },
      row: false,
      email: true,
    },
    {
      label: "muteEmail only → in-app still delivers",
      pref: { muteInApp: false, muteEmail: true },
      row: true,
      email: false,
    },
    {
      label: "both muted → silence",
      pref: { muteInApp: true, muteEmail: true },
      row: false,
      email: false,
    },
  ];

  it.each(matrix)("$label", async ({ pref, row, email }) => {
    if (pref) seedPrefs([{ userId: "u-alice", typeKey: "task-assigned", ...pref }]);

    const created = await notify({ ...base, email: genericEmail() });

    if (row) {
      expect(createdRecipients()).toEqual(["u-alice"]);
      expect(created).toHaveLength(1);
    } else {
      expect(createManyAndReturn).not.toHaveBeenCalled();
      expect(created).toEqual([]);
    }
    if (email) {
      expect(sentTo()).toEqual(["alice@example.com"]);
    } else {
      expect(mockedSend).not.toHaveBeenCalled();
    }
  });

  it("a mute only silences its own user in a broadcast", async () => {
    seedPrefs([
      { userId: "u-alice", typeKey: "task-assigned", muteInApp: true, muteEmail: true },
    ]);

    const created = await notify({
      ...base,
      recipientId: ["u-alice", "u-bob"],
      email: genericEmail(),
    });

    expect(createdRecipients()).toEqual(["u-bob"]);
    expect(created).toHaveLength(1);
    expect(sentTo()).toEqual(["bob@example.com"]);
  });

  it("mutes bind to rule-added recipients after expansion", async () => {
    ruleFindUnique.mockResolvedValue(rule({ recipientRoles: ["ADMIN"] }));
    seedPrefs([{ userId: "u-ada", typeKey: "task-assigned", muteEmail: true }]);

    await notify({ ...base, email: genericEmail() });

    // Ada still gets the in-app row, but her email mute wins.
    expect(createdRecipients().sort()).toEqual(["u-ada", "u-alice"]);
    expect(sentTo()).toEqual(["alice@example.com"]);
  });

  it("prefs are queried by exact type for exactly the resolved users", async () => {
    await notify({ ...base, email: genericEmail() });

    expect(prefFindMany).toHaveBeenCalledWith({
      where: { typeKey: "task-assigned", userId: { in: ["u-alice"] } },
    });
  });

  it("a pref for a different type does not mute", async () => {
    seedPrefs([{ userId: "u-alice", typeKey: "mention", muteInApp: true, muteEmail: true }]);

    const created = await notify({ ...base, email: genericEmail() });

    expect(created).toHaveLength(1);
    expect(sentTo()).toEqual(["alice@example.com"]);
  });
});

// ─── 6. Rule template substitution (email channel) ───────────────────

describe("rule template substitution", () => {
  it("substitutes {{recipientName}}, {{title}}, {{body}}, {{href}}", async () => {
    ruleFindUnique.mockResolvedValue(
      rule({
        subjectTemplate: "To {{recipientName}}: {{title}}",
        bodyTemplate: "{{body}} at {{href}}",
      })
    );

    await notify({ ...base, email: genericEmail() });

    expect(sentData(0).heading).toBe("To Alice: You were assigned a task");
    expect(sentData(0).body).toBe("Fix the door at /tasks#t-1");
  });

  it("{{heading}} and {{emailBody}} echo the caller's email data", async () => {
    ruleFindUnique.mockResolvedValue(
      rule({
        subjectTemplate: "[fwd] {{heading}}",
        bodyTemplate: "{{emailBody}} (via rule)",
      })
    );

    await notify({ ...base, email: genericEmail() });

    expect(sentData(0).heading).toBe("[fwd] Caller heading");
    expect(sentData(0).body).toBe("Caller email body (via rule)");
  });

  it("unknown variables render as empty strings (not leaked placeholders)", async () => {
    ruleFindUnique.mockResolvedValue(
      rule({ subjectTemplate: "A{{nope}}B{{alsoNope}}C" })
    );

    await notify({ ...base, email: genericEmail() });

    expect(sentData(0).heading).toBe("ABC");
  });

  it("tolerates whitespace inside the braces", async () => {
    ruleFindUnique.mockResolvedValue(rule({ subjectTemplate: "{{  title  }}!" }));

    await notify({ ...base, email: genericEmail() });

    expect(sentData(0).heading).toBe("You were assigned a task!");
  });

  it("missing params.body → {{body}} substitutes as empty; in-app row stores null", async () => {
    ruleFindUnique.mockResolvedValue(rule({ bodyTemplate: "[{{body}}]" }));

    await notify({ ...base, body: undefined, email: genericEmail() });

    expect(sentData(0).body).toBe("[]");
    expect(createdRows()[0].body).toBeNull();
  });

  it("no rule templates → caller's data passes through, only recipientName personalized", async () => {
    ruleFindUnique.mockResolvedValue(rule());

    await notify({ ...base, email: genericEmail() });

    expect(sentData(0)).toEqual({
      recipientName: "Alice",
      heading: "Caller heading",
      body: "Caller email body",
      cta: { label: "Open task", url: "https://ops.example.com/tasks#t-1" },
    });
  });

  const partialTemplateCases = [
    {
      label: "subjectTemplate alone leaves the body untouched",
      overrides: { subjectTemplate: "Only subject" },
      heading: "Only subject",
      body: "Caller email body",
    },
    {
      label: "bodyTemplate alone leaves the heading untouched",
      overrides: { bodyTemplate: "Only body" },
      heading: "Caller heading",
      body: "Only body",
    },
  ];

  it.each(partialTemplateCases)("$label", async ({ overrides, heading, body }) => {
    ruleFindUnique.mockResolvedValue(rule(overrides));

    await notify({ ...base, email: genericEmail() });

    expect(sentData(0).heading).toBe(heading);
    expect(sentData(0).body).toBe(body);
  });

  it("rule templates only rewrite the generic 'notification' template — others pass through untouched", async () => {
    ruleFindUnique.mockResolvedValue(
      rule({ subjectTemplate: "HIJACKED", bodyTemplate: "HIJACKED" })
    );
    const testEmailData = { to: "probe@example.com" };

    await notify({
      ...base,
      email: { templateKey: "test" as const, data: testEmailData },
    });

    expect(mockedSend.mock.calls[0][0]).toBe("test");
    // Exact equality: no heading/body/recipientName injected.
    expect(sentData(0)).toEqual({ to: "probe@example.com" });
    // The engine hands the template a shallow copy, not the caller's object.
    expect(sentData(0)).not.toBe(testEmailData);
  });

  it("non-generic data still gets recipientName personalization when the field exists", async () => {
    // The engine keys personalization on `"recipientName" in data`, not on
    // the template key.
    await notify({
      ...base,
      email: {
        templateKey: "test" as const,
        data: {
          to: "probe@example.com",
          recipientName: "Seed",
        } as unknown as TemplateDataMap["test"],
      },
    });

    expect(sentData(0)).toEqual({ to: "probe@example.com", recipientName: "Alice" });
  });

  it("substitution is per recipient in a broadcast", async () => {
    ruleFindUnique.mockResolvedValue(rule({ subjectTemplate: "{{recipientName}}!" }));

    await notify({ ...base, recipientId: ["u-alice", "u-bob"], email: genericEmail() });

    const headings = [sentData(0).heading, sentData(1).heading].sort();
    expect(headings).toEqual(["Alice!", "Bob!"]);
  });
});

// ─── 7. extraEmails ──────────────────────────────────────────────────

describe("extraEmails", () => {
  it("each extra address gets its own copy addressed to 'team', after user emails", async () => {
    ruleFindUnique.mockResolvedValue(
      rule({ extraEmails: ["ops@example.com", "audit@example.com"] })
    );

    await notify({ ...base, email: genericEmail() });

    expect(sentTo()).toEqual(["alice@example.com", "ops@example.com", "audit@example.com"]);
    expect(sentData(0).recipientName).toBe("Alice");
    expect(sentData(1).recipientName).toBe("team");
    expect(sentData(2).recipientName).toBe("team");
    // Audit context rides along on extra copies too.
    expect(sentOptions(1)).toEqual({
      to: "ops@example.com",
      entityType: "task",
      entityId: "t-1",
    });
  });

  it("rule templates apply to extra copies with recipientName 'team'", async () => {
    ruleFindUnique.mockResolvedValue(
      rule({
        extraEmails: ["ops@example.com"],
        subjectTemplate: "{{recipientName}} / {{title}}",
      })
    );

    await notify({ ...base, email: genericEmail() });

    expect(sentData(1).heading).toBe("team / You were assigned a task");
  });

  it("skips entries without an @, sends anything containing one", async () => {
    // The engine's ONLY validation on stored extraEmails is
    // String.includes("@") — stricter validation lives in the save action.
    ruleFindUnique.mockResolvedValue(
      rule({ extraEmails: ["not-an-email", "weird@localhost", "x@y"] })
    );

    await notify({ ...base, email: genericEmail() });

    expect(sentTo()).toEqual(["alice@example.com", "weird@localhost", "x@y"]);
  });

  it("extras get nothing when the caller sends no email block", async () => {
    ruleFindUnique.mockResolvedValue(rule({ extraEmails: ["ops@example.com"] }));

    const created = await notify({ ...base });

    expect(created).toHaveLength(1);
    expect(mockedSend).not.toHaveBeenCalled();
  });

  it("channelEmail=false suppresses extras too", async () => {
    ruleFindUnique.mockResolvedValue(
      rule({ channelEmail: false, extraEmails: ["ops@example.com"] })
    );

    await notify({ ...base, email: genericEmail() });

    expect(mockedSend).not.toHaveBeenCalled();
  });
});

// ─── 8. Broadcast personalization, row contents, revalidation ────────

describe("broadcast personalization & row contents", () => {
  it("two recipients get two distinct personalized emails", async () => {
    await notify({ ...base, recipientId: ["u-alice", "u-bob"], email: genericEmail() });

    expect(mockedSend).toHaveBeenCalledTimes(2);
    expect(sentTo()).toEqual(["alice@example.com", "bob@example.com"]);
    expect(sentData(0).recipientName).toBe("Alice");
    expect(sentData(1).recipientName).toBe("Bob");
    // The rest of the payload is identical for both.
    expect(sentData(0).heading).toBe("Caller heading");
    expect(sentData(1).heading).toBe("Caller heading");
  });

  it("rows carry the full payload per recipient with one shared createdAt", async () => {
    await notify({ ...base, recipientId: ["u-alice", "u-bob"] });

    const rows = createdRows();
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row).toMatchObject({
        type: "task-assigned",
        title: "You were assigned a task",
        body: "Fix the door",
        href: "/tasks#t-1",
        entityType: "task",
        entityId: "t-1",
        actorId: "u-actor",
      });
      expect(row.createdAt).toBeInstanceOf(Date);
    }
    expect(rows[0].createdAt).toBe(rows[1].createdAt);
  });

  it("optional fields default to null on the row", async () => {
    await notify({ recipientId: "u-alice", type: "system", title: "Minimal" });

    expect(createdRows()[0]).toMatchObject({
      recipientId: "u-alice",
      type: "system",
      title: "Minimal",
      body: null,
      href: null,
      entityType: null,
      entityId: null,
      actorId: null,
    });
  });

  it("returns exactly the rows createManyAndReturn produced", async () => {
    const created = await notify({ ...base, recipientId: ["u-alice", "u-bob"] });

    expect(created.map((n) => n.id)).toEqual(["n-0", "n-1"]);
    expect(created[0].readAt).toBeNull();
  });

  it("revalidates /notifications plus each recipient's team page", async () => {
    await notify({ ...base, recipientId: ["u-alice", "u-bob"] });

    expect(mockedRevalidate.mock.calls.map((c) => c[0])).toEqual([
      "/notifications",
      "/team/u-alice",
      "/team/u-bob",
    ]);
  });

  it("no revalidation when nothing was created (email may still send)", async () => {
    seedPrefs([{ userId: "u-alice", typeKey: "task-assigned", muteInApp: true }]);

    await notify({ ...base, email: genericEmail() });

    expect(mockedRevalidate).not.toHaveBeenCalled();
    expect(sentTo()).toEqual(["alice@example.com"]);
  });
});

// ─── 9. Failure isolation ────────────────────────────────────────────

describe("failure isolation", () => {
  it("an email rejection never fails notify(): rows are returned and the error is logged", async () => {
    const smtpDown = new Error("smtp down");
    mockedSend.mockRejectedValue(smtpDown);

    const created = await notify({ ...base, email: genericEmail() });

    expect(created).toHaveLength(1);
    expect(createdRecipients()).toEqual(["u-alice"]);
    expect(mockedLogError).toHaveBeenCalledWith(
      "notifications.email",
      "Email delivery failed",
      smtpDown,
      { recipientId: "u-alice" }
    );
  });

  // Regression test: the try/catch used to wrap the WHOLE email fan-out
  // loop, so one recipient's rejection (e.g. a template render throw,
  // which escapes sendFromTemplate's driver-level catch) silently
  // starved every later recipient in the same call. Sends are now
  // isolated per recipient: the failure is logged with the recipient's
  // id and the loop continues through users AND extraEmails.
  it("one recipient's email rejection does not abort the remaining email fan-out", async () => {
    ruleFindUnique.mockResolvedValue(rule({ extraEmails: ["ops@example.com"] }));
    mockedSend.mockRejectedValueOnce(new Error("render blew up"));

    const created = await notify({
      ...base,
      recipientId: ["u-alice", "u-bob"],
      email: genericEmail(),
    });

    // Both in-app rows exist — they were written before the email phase.
    expect(created).toHaveLength(2);
    expect(createdRecipients().sort()).toEqual(["u-alice", "u-bob"]);
    // All three sends were attempted: alice (rejected), bob, ops@.
    expect(mockedSend).toHaveBeenCalledTimes(3);
    const attemptedTo = mockedSend.mock.calls.map((c) => c[2]?.to);
    expect(attemptedTo).toContain("ops@example.com");
    // The failure was logged with the recipient's id for triage.
    expect(mockedLogError).toHaveBeenCalledWith(
      "notifications.email",
      "Email delivery failed",
      expect.any(Error),
      expect.objectContaining({ recipientId: expect.any(String) })
    );
  });

  it("a driver that RESOLVES with success:false does not abort the loop", async () => {
    mockedSend.mockResolvedValue({ success: false, driver: "mock", error: "bounced" });

    const created = await notify({
      ...base,
      recipientId: ["u-alice", "u-bob"],
      email: genericEmail(),
    });

    expect(created).toHaveLength(2);
    expect(mockedSend).toHaveBeenCalledTimes(2);
    expect(mockedLogError).not.toHaveBeenCalled();
  });

  it("an in-app write failure propagates and the email phase never runs", async () => {
    // There is deliberately no catch around createManyAndReturn — a DB
    // failure surfaces to the caller, and emails are not attempted.
    createManyAndReturn.mockRejectedValue(new Error("db write failed"));

    await expect(notify({ ...base, email: genericEmail() })).rejects.toThrow(
      "db write failed"
    );
    expect(mockedSend).not.toHaveBeenCalled();
  });
});
