import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the Prisma client so we can drive resolution behavior from
// fixtures rather than a real DB. We keep the surface minimal — only
// the methods buildPortalView / getPortalSubject / loadPortalStep
// actually call.
vi.mock("@/lib/db", () => ({
  db: {
    portalToken: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    user: { findUnique: vi.fn() },
    workflowInstance: { findMany: vi.fn(), count: vi.fn() },
    workflowInstanceStep: { findUnique: vi.fn() },
  },
}));

import { db } from "@/lib/db";
import { _testMemoryStorage } from "@/lib/rate-limit";
import {
  getPortalSubject,
  buildPortalView,
  loadPortalStep,
  PORTAL_STEP_TYPES,
} from "./portal";

const portalToken = db.portalToken as unknown as {
  findUnique: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
};
const userMock = db.user as unknown as { findUnique: ReturnType<typeof vi.fn> };
const wfInstanceMock = db.workflowInstance as unknown as {
  findMany: ReturnType<typeof vi.fn>;
  count: ReturnType<typeof vi.fn>;
};
const wfStepMock = db.workflowInstanceStep as unknown as {
  findUnique: ReturnType<typeof vi.fn>;
};

describe("PORTAL_STEP_TYPES", () => {
  it("includes the four interactive step types and nothing else", () => {
    expect(PORTAL_STEP_TYPES.sort()).toEqual(
      [
        "ASSIGN_TASK_TO_SUBJECT",
        "REQUEST_DOCUMENT",
        "REQUEST_FORM",
        "REQUEST_SIGNATURE",
      ].sort()
    );
  });
});

describe("getPortalSubject", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // The brute-force limiter shares one in-memory map per process —
    // start each test with fresh buckets.
    _testMemoryStorage.clear?.();
    // Default: update succeeds. Tests can override.
    portalToken.update.mockResolvedValue({ id: "tk1" });
  });

  it("returns null for an unknown token", async () => {
    portalToken.findUnique.mockResolvedValue(null);
    const r = await getPortalSubject("nope");
    expect(r).toBeNull();
  });

  it("returns null for an expired token", async () => {
    portalToken.findUnique.mockResolvedValue({
      id: "tk1",
      subjectType: "EMPLOYEE",
      subjectId: "u1",
      token: "abc",
      expiresAt: new Date(Date.now() - 1000),
    });
    const r = await getPortalSubject("abc");
    expect(r).toBeNull();
  });

  it("returns null when the subject employee row has been deleted", async () => {
    portalToken.findUnique.mockResolvedValue({
      id: "tk1",
      subjectType: "EMPLOYEE",
      subjectId: "u1",
      token: "abc",
      expiresAt: null,
    });
    userMock.findUnique.mockResolvedValueOnce(null);
    expect(await getPortalSubject("abc")).toBeNull();
  });

  it("returns null for an inactive employee without an open offboarding workflow", async () => {
    portalToken.findUnique.mockResolvedValue({
      id: "tk1",
      subjectType: "EMPLOYEE",
      subjectId: "u1",
      token: "abc",
      expiresAt: null,
    });
    userMock.findUnique.mockResolvedValueOnce({
      name: "Alex",
      isActive: false,
    });
    wfInstanceMock.count.mockResolvedValueOnce(0);
    expect(await getPortalSubject("abc")).toBeNull();
  });

  it("resolves an inactive employee when at least one OFFBOARDING workflow is open", async () => {
    portalToken.findUnique.mockResolvedValue({
      id: "tk1",
      subjectType: "EMPLOYEE",
      subjectId: "u1",
      token: "abc",
      expiresAt: null,
    });
    userMock.findUnique.mockResolvedValueOnce({
      name: "Alex",
      isActive: false,
    });
    wfInstanceMock.count.mockResolvedValueOnce(1);
    const r = await getPortalSubject("abc");
    expect(r).toMatchObject({ subjectType: "EMPLOYEE", subjectId: "u1" });
  });

  it("resolves to subject for an active EMPLOYEE token", async () => {
    portalToken.findUnique.mockResolvedValue({
      id: "tk1",
      subjectType: "EMPLOYEE",
      subjectId: "u1",
      token: "abc",
      expiresAt: null,
    });
    userMock.findUnique.mockResolvedValue({
      name: "Alex Rivera",
      isActive: true,
    });
    const r = await getPortalSubject("abc");
    expect(r).toMatchObject({
      subjectType: "EMPLOYEE",
      subjectId: "u1",
      displayName: "Alex Rivera",
    });
  });

  it("returns null for unknown subjectType (e.g. legacy CANDIDATE rows on a stale DB)", async () => {
    portalToken.findUnique.mockResolvedValue({
      id: "tk1",
      // Use a value that's not in the current enum to exercise the
      // "displayName stays as default" path. With the Candidate model
      // gone, this is what the resolver does for any unknown type.
      subjectType: "CUSTOM",
      subjectId: "x",
      token: "abc",
      expiresAt: null,
    });
    const r = await getPortalSubject("abc");
    // Falls through to the "Subject {id}" fallback name.
    expect(r?.displayName).toContain("Subject");
  });

  it("rate-limits repeated resolutions of one token without leaking an oracle", async () => {
    portalToken.findUnique.mockResolvedValue(null);
    // Per-token bucket holds 30; exhaust it.
    for (let i = 0; i < 30; i++) {
      expect(await getPortalSubject("brute-force-guess")).toBeNull();
    }
    expect(portalToken.findUnique).toHaveBeenCalledTimes(30);
    // 31st attempt: same null answer, but the DB is never touched.
    expect(await getPortalSubject("brute-force-guess")).toBeNull();
    expect(portalToken.findUnique).toHaveBeenCalledTimes(30);
  });
});

describe("buildPortalView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("partitions steps into pending vs completed and skips SKIPPED", async () => {
    wfInstanceMock.findMany.mockResolvedValue([
      {
        id: "i1",
        workflowTemplate: { name: "Onboarding" },
        steps: [
          {
            id: "s1",
            status: "PENDING",
            scheduledFor: new Date("2026-06-01"),
            workflowStep: {
              name: "Upload W-4",
              stepType: "REQUEST_DOCUMENT",
              isRequired: true,
              config: '{"documentName":"W-4","required":true}',
            },
          },
          {
            id: "s2",
            status: "COMPLETED",
            completedAt: new Date("2026-05-20"),
            workflowStep: {
              name: "Sign offer",
              stepType: "REQUEST_SIGNATURE",
              isRequired: true,
              config: '{"documentText":"...","required":true}',
            },
          },
          {
            id: "s3",
            status: "SKIPPED",
            workflowStep: {
              name: "Optional survey",
              stepType: "REQUEST_FORM",
              isRequired: false,
              config: '{"fields":[]}',
            },
          },
          {
            id: "s4",
            // SEND_EMAIL isn't a portal type — should not appear in
            // either list.
            status: "COMPLETED",
            completedAt: new Date("2026-05-19"),
            workflowStep: {
              name: "Welcome email",
              stepType: "SEND_EMAIL",
              isRequired: true,
              config: "{}",
            },
          },
        ],
      },
    ]);

    const view = await buildPortalView({
      subjectType: "EMPLOYEE",
      subjectId: "u1",
      displayName: "Alex",
      tokenId: "tk1",
    });

    expect(view.pending).toHaveLength(1);
    expect(view.pending[0].stepName).toBe("Upload W-4");
    expect(view.completed).toHaveLength(1);
    expect(view.completed[0].stepName).toBe("Sign offer");
    // total counts everything except SKIPPED — so 3 (pending s1 + completed s2 + completed s4 SEND_EMAIL).
    expect(view.total).toBe(3);
  });

  it("sorts pending oldest-scheduled first", async () => {
    wfInstanceMock.findMany.mockResolvedValue([
      {
        id: "i1",
        workflowTemplate: { name: "Onboarding" },
        steps: [
          {
            id: "s1",
            status: "PENDING",
            scheduledFor: new Date("2026-06-15"),
            workflowStep: {
              name: "Newer",
              stepType: "REQUEST_DOCUMENT",
              isRequired: true,
              config: "{}",
            },
          },
          {
            id: "s2",
            status: "PENDING",
            scheduledFor: new Date("2026-06-01"),
            workflowStep: {
              name: "Older",
              stepType: "REQUEST_DOCUMENT",
              isRequired: true,
              config: "{}",
            },
          },
        ],
      },
    ]);

    const view = await buildPortalView({
      subjectType: "EMPLOYEE",
      subjectId: "u1",
      displayName: "Alex",
      tokenId: "tk1",
    });
    expect(view.pending.map((p) => p.stepName)).toEqual(["Older", "Newer"]);
  });

  it("returns empty arrays when the subject has no instances", async () => {
    wfInstanceMock.findMany.mockResolvedValue([]);
    const view = await buildPortalView({
      subjectType: "EMPLOYEE",
      subjectId: "u1",
      displayName: "Alex",
      tokenId: "tk1",
    });
    expect(view.pending).toEqual([]);
    expect(view.completed).toEqual([]);
    expect(view.total).toBe(0);
  });
});

describe("loadPortalStep", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _testMemoryStorage.clear?.();
    portalToken.update.mockResolvedValue({ id: "tk1" });
  });

  it("returns null when the token is invalid", async () => {
    portalToken.findUnique.mockResolvedValue(null);
    const r = await loadPortalStep("bad", "step1");
    expect(r).toBeNull();
  });

  it("returns null when the step belongs to a different subject", async () => {
    portalToken.findUnique.mockResolvedValue({
      id: "tk1",
      subjectType: "EMPLOYEE",
      subjectId: "u1",
      token: "abc",
      expiresAt: null,
    });
    userMock.findUnique.mockResolvedValue({
      name: "Alex",
      isActive: true,
    });
    wfStepMock.findUnique.mockResolvedValue({
      id: "step1",
      workflowStep: { stepType: "REQUEST_DOCUMENT" },
      workflowInstance: {
        subjectType: "EMPLOYEE",
        subjectId: "DIFFERENT_USER",
      },
    });
    const r = await loadPortalStep("abc", "step1");
    expect(r).toBeNull();
  });

  it("returns the step when token + step subject align", async () => {
    portalToken.findUnique.mockResolvedValue({
      id: "tk1",
      subjectType: "EMPLOYEE",
      subjectId: "u1",
      token: "abc",
      expiresAt: null,
    });
    userMock.findUnique.mockResolvedValue({
      name: "Alex",
      isActive: true,
    });
    wfStepMock.findUnique.mockResolvedValue({
      id: "step1",
      status: "PENDING",
      workflowStep: { stepType: "REQUEST_DOCUMENT" },
      workflowInstance: {
        status: "IN_PROGRESS",
        subjectType: "EMPLOYEE",
        subjectId: "u1",
      },
    });
    const r = await loadPortalStep("abc", "step1");
    expect(r).not.toBeNull();
    expect(r?.subject.subjectId).toBe("u1");
  });

  it("returns null when the step is already COMPLETED", async () => {
    portalToken.findUnique.mockResolvedValue({
      id: "tk1",
      subjectType: "EMPLOYEE",
      subjectId: "u1",
      token: "abc",
      expiresAt: null,
    });
    userMock.findUnique.mockResolvedValue({ name: "Alex", isActive: true });
    wfStepMock.findUnique.mockResolvedValue({
      id: "step1",
      status: "COMPLETED",
      workflowStep: { stepType: "REQUEST_DOCUMENT" },
      workflowInstance: {
        status: "IN_PROGRESS",
        subjectType: "EMPLOYEE",
        subjectId: "u1",
      },
    });
    expect(await loadPortalStep("abc", "step1")).toBeNull();
  });

  it("returns null when the step is SKIPPED", async () => {
    portalToken.findUnique.mockResolvedValue({
      id: "tk1",
      subjectType: "EMPLOYEE",
      subjectId: "u1",
      token: "abc",
      expiresAt: null,
    });
    userMock.findUnique.mockResolvedValue({ name: "Alex", isActive: true });
    wfStepMock.findUnique.mockResolvedValue({
      id: "step1",
      status: "SKIPPED",
      workflowStep: { stepType: "REQUEST_DOCUMENT" },
      workflowInstance: {
        status: "IN_PROGRESS",
        subjectType: "EMPLOYEE",
        subjectId: "u1",
      },
    });
    expect(await loadPortalStep("abc", "step1")).toBeNull();
  });

  it("returns null when the parent instance is COMPLETED", async () => {
    portalToken.findUnique.mockResolvedValue({
      id: "tk1",
      subjectType: "EMPLOYEE",
      subjectId: "u1",
      token: "abc",
      expiresAt: null,
    });
    userMock.findUnique.mockResolvedValue({ name: "Alex", isActive: true });
    wfStepMock.findUnique.mockResolvedValue({
      id: "step1",
      status: "PENDING",
      workflowStep: { stepType: "REQUEST_DOCUMENT" },
      workflowInstance: {
        status: "COMPLETED",
        subjectType: "EMPLOYEE",
        subjectId: "u1",
      },
    });
    expect(await loadPortalStep("abc", "step1")).toBeNull();
  });

  it("returns null when the parent instance is CANCELLED", async () => {
    portalToken.findUnique.mockResolvedValue({
      id: "tk1",
      subjectType: "EMPLOYEE",
      subjectId: "u1",
      token: "abc",
      expiresAt: null,
    });
    userMock.findUnique.mockResolvedValue({ name: "Alex", isActive: true });
    wfStepMock.findUnique.mockResolvedValue({
      id: "step1",
      status: "PENDING",
      workflowStep: { stepType: "REQUEST_DOCUMENT" },
      workflowInstance: {
        status: "CANCELLED",
        subjectType: "EMPLOYEE",
        subjectId: "u1",
      },
    });
    expect(await loadPortalStep("abc", "step1")).toBeNull();
  });
});
