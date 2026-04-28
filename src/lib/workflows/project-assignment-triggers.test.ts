import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  db: {
    workflowTrigger: { findMany: vi.fn() },
    workflowInstance: { findFirst: vi.fn() },
  },
}));
vi.mock("./engine", () => ({
  createInstance: vi.fn(),
}));

import { db } from "@/lib/db";
import { createInstance } from "./engine";
import { fireProjectAssignmentTriggers } from "./triggers";

const triggerMock = db.workflowTrigger as unknown as {
  findMany: ReturnType<typeof vi.fn>;
};
const instanceMock = db.workflowInstance as unknown as {
  findFirst: ReturnType<typeof vi.fn>;
};
const createInstanceMock = createInstance as ReturnType<typeof vi.fn>;

const baseTrigger = {
  id: "t1",
  workflowTemplateId: "tpl1",
  triggerType: "PROJECT_ASSIGNMENT" as const,
  isActive: true,
  workflowTemplate: { name: "Project welcome", subjectEntityType: "EMPLOYEE" },
};

describe("fireProjectAssignmentTriggers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createInstanceMock.mockResolvedValue({
      instanceId: "inst1",
      scheduledStepIds: [],
    });
    instanceMock.findFirst.mockResolvedValue(null);
  });

  it("does nothing when no triggers are configured", async () => {
    triggerMock.findMany.mockResolvedValue([]);
    const r = await fireProjectAssignmentTriggers({
      userId: "u1",
      projectId: "p1",
      createdById: "admin",
    });
    expect(r.instanceIds).toEqual([]);
    expect(createInstanceMock).not.toHaveBeenCalled();
  });

  it("fires a wildcard trigger for any project", async () => {
    triggerMock.findMany.mockResolvedValue([
      { ...baseTrigger, config: JSON.stringify({}) },
    ]);
    const r = await fireProjectAssignmentTriggers({
      userId: "u1",
      projectId: "p1",
      createdById: "admin",
    });
    expect(r.instanceIds).toEqual(["inst1"]);
    expect(createInstanceMock).toHaveBeenCalledWith(
      expect.objectContaining({
        templateId: "tpl1",
        subjectType: "EMPLOYEE",
        subjectId: "u1",
      })
    );
  });

  it("fires a project-scoped trigger only when projectId matches", async () => {
    triggerMock.findMany.mockResolvedValue([
      { ...baseTrigger, config: JSON.stringify({ projectId: "p1" }) },
    ]);
    // Match
    let r = await fireProjectAssignmentTriggers({
      userId: "u1",
      projectId: "p1",
      createdById: "admin",
    });
    expect(r.instanceIds).toEqual(["inst1"]);

    createInstanceMock.mockClear();
    // Different project — should skip
    r = await fireProjectAssignmentTriggers({
      userId: "u2",
      projectId: "p2",
      createdById: "admin",
    });
    expect(r.instanceIds).toEqual([]);
    expect(createInstanceMock).not.toHaveBeenCalled();
  });

  it("filters by serviceOfferingId when set", async () => {
    triggerMock.findMany.mockResolvedValue([
      {
        ...baseTrigger,
        config: JSON.stringify({ serviceOfferingId: "svc1" }),
      },
    ]);
    let r = await fireProjectAssignmentTriggers({
      userId: "u1",
      projectId: "p1",
      serviceOfferingId: "svc1",
      createdById: "admin",
    });
    expect(r.instanceIds).toEqual(["inst1"]);

    createInstanceMock.mockClear();
    r = await fireProjectAssignmentTriggers({
      userId: "u1",
      projectId: "p1",
      serviceOfferingId: "svc-other",
      createdById: "admin",
    });
    expect(r.instanceIds).toEqual([]);
  });

  it("skips a user who already has a non-cancelled instance of this template", async () => {
    triggerMock.findMany.mockResolvedValue([
      { ...baseTrigger, config: JSON.stringify({}) },
    ]);
    instanceMock.findFirst.mockResolvedValue({ id: "existing" });
    const r = await fireProjectAssignmentTriggers({
      userId: "u1",
      projectId: "p1",
      createdById: "admin",
    });
    expect(r.instanceIds).toEqual([]);
    expect(createInstanceMock).not.toHaveBeenCalled();
  });

  it("captures createInstance failures without aborting siblings", async () => {
    triggerMock.findMany.mockResolvedValue([
      {
        ...baseTrigger,
        id: "t-fail",
        config: JSON.stringify({}),
      },
      {
        ...baseTrigger,
        id: "t-ok",
        workflowTemplateId: "tpl-ok",
        config: JSON.stringify({}),
      },
    ]);
    createInstanceMock
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce({ instanceId: "inst-ok", scheduledStepIds: [] });

    const r = await fireProjectAssignmentTriggers({
      userId: "u1",
      projectId: "p1",
      createdById: "admin",
    });
    expect(r.instanceIds).toEqual(["inst-ok"]);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]).toContain("boom");
  });

  it("ignores triggers with malformed config JSON", async () => {
    triggerMock.findMany.mockResolvedValue([
      { ...baseTrigger, config: "not json" },
    ]);
    const r = await fireProjectAssignmentTriggers({
      userId: "u1",
      projectId: "p1",
      createdById: "admin",
    });
    expect(r.instanceIds).toEqual([]);
    expect(r.errors[0]).toContain("invalid config JSON");
  });
});
