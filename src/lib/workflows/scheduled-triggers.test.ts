import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock both Prisma and the engine — focus on the trigger filtering /
// idempotency math.
vi.mock("@/lib/db", () => ({
  db: {
    workflowTrigger: { findMany: vi.fn() },
    user: { findMany: vi.fn() },
    workflowInstance: { findMany: vi.fn() },
  },
}));
vi.mock("./engine", () => ({
  createInstance: vi.fn(),
}));

import { db } from "@/lib/db";
import { createInstance } from "./engine";
import { fireScheduledDateTriggers } from "./triggers";

const triggerMock = db.workflowTrigger as unknown as {
  findMany: ReturnType<typeof vi.fn>;
};
const userMock = db.user as unknown as {
  findMany: ReturnType<typeof vi.fn>;
};
const instanceMock = db.workflowInstance as unknown as {
  findMany: ReturnType<typeof vi.fn>;
};
const createInstanceMock = createInstance as ReturnType<typeof vi.fn>;

describe("fireScheduledDateTriggers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createInstanceMock.mockResolvedValue({
      instanceId: "inst1",
      scheduledStepIds: [],
    });
  });

  it("returns empty when no triggers are configured", async () => {
    triggerMock.findMany.mockResolvedValue([]);
    const r = await fireScheduledDateTriggers(new Date("2026-06-15"));
    expect(r.instanceIds).toEqual([]);
    expect(userMock.findMany).not.toHaveBeenCalled();
  });

  it("ignores triggers with malformed config JSON", async () => {
    triggerMock.findMany.mockResolvedValue([
      {
        id: "t1",
        workflowTemplateId: "tpl1",
        triggerType: "SCHEDULED_DATE",
        config: "not-json",
        isActive: true,
        workflowTemplate: { name: "X", subjectEntityType: "EMPLOYEE" },
      },
    ]);
    const r = await fireScheduledDateTriggers(new Date("2026-06-15"));
    expect(r.errors[0]).toContain("invalid config JSON");
    expect(r.instanceIds).toEqual([]);
  });

  it("fires for an employee whose terminationDate falls in the offset window", async () => {
    triggerMock.findMany.mockResolvedValue([
      {
        id: "t1",
        workflowTemplateId: "tpl1",
        triggerType: "SCHEDULED_DATE",
        // 7 days BEFORE termination — offsetDays: -7
        config: JSON.stringify({ dateField: "terminationDate", offsetDays: -7 }),
        isActive: true,
        workflowTemplate: { name: "Offboarding", subjectEntityType: "EMPLOYEE" },
      },
    ]);
    // Today is 2026-06-15, offset -7 → look for terminationDate on 2026-06-22.
    const termDate = new Date("2026-06-22T00:00:00Z");
    userMock.findMany.mockResolvedValue([
      { id: "u1", terminationDate: termDate },
    ]);
    instanceMock.findMany.mockResolvedValue([]); // no existing instances

    const r = await fireScheduledDateTriggers(new Date("2026-06-15T08:00:00Z"));
    expect(r.instanceIds).toEqual(["inst1"]);
    expect(createInstanceMock).toHaveBeenCalledWith(
      expect.objectContaining({
        templateId: "tpl1",
        subjectType: "EMPLOYEE",
        subjectId: "u1",
        targetDate: termDate,
      })
    );
  });

  it("skips employees who already have an active instance of the template", async () => {
    triggerMock.findMany.mockResolvedValue([
      {
        id: "t1",
        workflowTemplateId: "tpl1",
        triggerType: "SCHEDULED_DATE",
        config: JSON.stringify({ dateField: "terminationDate", offsetDays: -7 }),
        isActive: true,
        workflowTemplate: { name: "Offboarding", subjectEntityType: "EMPLOYEE" },
      },
    ]);
    userMock.findMany.mockResolvedValue([
      { id: "u1", terminationDate: new Date("2026-06-22T00:00:00Z") },
    ]);
    instanceMock.findMany.mockResolvedValue([{ subjectId: "u1" }]);

    const r = await fireScheduledDateTriggers(new Date("2026-06-15T08:00:00Z"));
    expect(r.instanceIds).toEqual([]);
    expect(createInstanceMock).not.toHaveBeenCalled();
  });

  it("skips when subjectEntityType doesn't match (e.g. CANDIDATE template trying to use terminationDate)", async () => {
    triggerMock.findMany.mockResolvedValue([
      {
        id: "t1",
        workflowTemplateId: "tpl1",
        triggerType: "SCHEDULED_DATE",
        config: JSON.stringify({ dateField: "terminationDate", offsetDays: -7 }),
        isActive: true,
        workflowTemplate: { name: "Hiring", subjectEntityType: "CANDIDATE" },
      },
    ]);
    const r = await fireScheduledDateTriggers(new Date("2026-06-15"));
    expect(r.instanceIds).toEqual([]);
    // User query never fires when no eligible templates exist.
    expect(userMock.findMany).not.toHaveBeenCalled();
  });

  it("captures createInstance errors per-trigger without aborting the run", async () => {
    triggerMock.findMany.mockResolvedValue([
      {
        id: "t1",
        workflowTemplateId: "tpl1",
        triggerType: "SCHEDULED_DATE",
        config: JSON.stringify({ dateField: "terminationDate", offsetDays: 0 }),
        isActive: true,
        workflowTemplate: { name: "Boom", subjectEntityType: "EMPLOYEE" },
      },
    ]);
    userMock.findMany.mockResolvedValue([
      { id: "u1", terminationDate: new Date("2026-06-15T00:00:00Z") },
      { id: "u2", terminationDate: new Date("2026-06-15T12:00:00Z") },
    ]);
    instanceMock.findMany.mockResolvedValue([]);
    createInstanceMock
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce({ instanceId: "inst2", scheduledStepIds: [] });

    const r = await fireScheduledDateTriggers(new Date("2026-06-15T10:00:00Z"));
    expect(r.instanceIds).toEqual(["inst2"]);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]).toContain("boom");
  });
});
