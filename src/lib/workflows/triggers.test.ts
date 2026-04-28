import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock both Prisma and the engine so this test stays purely
// behavior-focused — we're verifying trigger filtering logic, not DB
// integration.
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
import { fireEntityCreateTriggers } from "./triggers";

const mockedFindMany = db.workflowTrigger.findMany as ReturnType<typeof vi.fn>;
const mockedInstanceFindFirst = db.workflowInstance
  .findFirst as ReturnType<typeof vi.fn>;
const mockedCreateInstance = createInstance as ReturnType<typeof vi.fn>;

describe("fireEntityCreateTriggers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: no existing instance for the subject — dedup check
    // passes through. Tests that exercise the dedup branch override.
    mockedInstanceFindFirst.mockResolvedValue(null);
    mockedCreateInstance.mockResolvedValue({
      instanceId: "inst1",
      scheduledStepIds: [],
    });
  });

  it("returns early for entity types we don't support", async () => {
    const r = await fireEntityCreateTriggers({
      entityType: "Project" as unknown as "User",
      entityId: "p1",
      createdById: "admin",
    });
    expect(r.instanceIds).toEqual([]);
    expect(mockedFindMany).not.toHaveBeenCalled();
  });

  it("matches a User trigger when the config entityType is 'User'", async () => {
    mockedFindMany.mockResolvedValue([
      {
        id: "t1",
        workflowTemplateId: "tpl1",
        triggerType: "ENTITY_CREATE",
        config: JSON.stringify({ entityType: "User" }),
        isActive: true,
        workflowTemplate: { name: "Onboarding", subjectEntityType: "EMPLOYEE" },
      },
    ]);
    const r = await fireEntityCreateTriggers({
      entityType: "User",
      entityId: "u1",
      createdById: "admin",
    });
    expect(r.instanceIds).toEqual(["inst1"]);
    expect(mockedCreateInstance).toHaveBeenCalledWith(
      expect.objectContaining({
        templateId: "tpl1",
        subjectType: "EMPLOYEE",
        subjectId: "u1",
        createdById: "admin",
      })
    );
  });

  it("skips triggers whose config entityType doesn't match", async () => {
    mockedFindMany.mockResolvedValue([
      {
        id: "t1",
        workflowTemplateId: "tpl1",
        triggerType: "ENTITY_CREATE",
        config: JSON.stringify({ entityType: "Project" }),
        isActive: true,
        workflowTemplate: { name: "Project flow", subjectEntityType: "CUSTOM" },
      },
    ]);
    const r = await fireEntityCreateTriggers({
      entityType: "User",
      entityId: "u1",
      createdById: "admin",
    });
    expect(r.instanceIds).toEqual([]);
    expect(mockedCreateInstance).not.toHaveBeenCalled();
  });

  it("skips triggers whose template subject doesn't match the entity", async () => {
    mockedFindMany.mockResolvedValue([
      {
        id: "t1",
        workflowTemplateId: "tpl1",
        triggerType: "ENTITY_CREATE",
        // Mismatch: trigger says User but template subject is CUSTOM —
        // misconfigured because ENTITY_CREATE for User must run against
        // an EMPLOYEE-subject template.
        config: JSON.stringify({ entityType: "User" }),
        isActive: true,
        workflowTemplate: { name: "Misconfigured", subjectEntityType: "CUSTOM" },
      },
    ]);
    const r = await fireEntityCreateTriggers({
      entityType: "User",
      entityId: "u1",
      createdById: "admin",
    });
    expect(r.instanceIds).toEqual([]);
  });

  it("captures createInstance failures as errors without throwing", async () => {
    mockedFindMany.mockResolvedValue([
      {
        id: "t1",
        workflowTemplateId: "tpl1",
        triggerType: "ENTITY_CREATE",
        config: JSON.stringify({ entityType: "User" }),
        isActive: true,
        workflowTemplate: { name: "Boom", subjectEntityType: "EMPLOYEE" },
      },
    ]);
    mockedCreateInstance.mockRejectedValueOnce(new Error("boom"));
    const r = await fireEntityCreateTriggers({
      entityType: "User",
      entityId: "u1",
      createdById: "admin",
    });
    expect(r.instanceIds).toEqual([]);
    expect(r.errors[0]).toContain("Boom");
    expect(r.errors[0]).toContain("boom");
  });

  it("matches case-insensitively on the config entityType string", async () => {
    mockedFindMany.mockResolvedValue([
      {
        id: "t1",
        workflowTemplateId: "tpl1",
        triggerType: "ENTITY_CREATE",
        config: JSON.stringify({ entityType: "user" }),
        isActive: true,
        workflowTemplate: { name: "Onboarding", subjectEntityType: "EMPLOYEE" },
      },
    ]);
    const r = await fireEntityCreateTriggers({
      entityType: "User",
      entityId: "u1",
      createdById: "admin",
    });
    expect(r.instanceIds).toEqual(["inst1"]);
  });

  it("skips firing when a non-cancelled instance for the same subject already exists", async () => {
    mockedFindMany.mockResolvedValue([
      {
        id: "t1",
        workflowTemplateId: "tpl1",
        triggerType: "ENTITY_CREATE",
        config: JSON.stringify({ entityType: "User" }),
        isActive: true,
        workflowTemplate: { name: "Onboarding", subjectEntityType: "EMPLOYEE" },
      },
    ]);
    // Dedup hit: the user already has an in-progress onboarding.
    mockedInstanceFindFirst.mockResolvedValueOnce({ id: "existing-instance" });

    const r = await fireEntityCreateTriggers({
      entityType: "User",
      entityId: "u1",
      createdById: "admin",
    });
    expect(r.instanceIds).toEqual([]);
    expect(mockedCreateInstance).not.toHaveBeenCalled();
  });

  it("fires when no existing instance shadows this subject", async () => {
    mockedFindMany.mockResolvedValue([
      {
        id: "t1",
        workflowTemplateId: "tpl1",
        triggerType: "ENTITY_CREATE",
        config: JSON.stringify({ entityType: "User" }),
        isActive: true,
        workflowTemplate: { name: "Onboarding", subjectEntityType: "EMPLOYEE" },
      },
    ]);
    mockedInstanceFindFirst.mockResolvedValueOnce(null);
    const r = await fireEntityCreateTriggers({
      entityType: "User",
      entityId: "u1",
      createdById: "admin",
    });
    expect(r.instanceIds).toEqual(["inst1"]);
    expect(mockedCreateInstance).toHaveBeenCalled();
  });

  it("ignores triggers with malformed config JSON and reports an error", async () => {
    mockedFindMany.mockResolvedValue([
      {
        id: "t1",
        workflowTemplateId: "tpl1",
        triggerType: "ENTITY_CREATE",
        config: "not-json",
        isActive: true,
        workflowTemplate: { name: "Bad", subjectEntityType: "EMPLOYEE" },
      },
    ]);
    const r = await fireEntityCreateTriggers({
      entityType: "User",
      entityId: "u1",
      createdById: "admin",
    });
    expect(r.instanceIds).toEqual([]);
    expect(r.errors[0]).toContain("invalid config JSON");
  });
});
