import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the Prisma client + activity log before importing the module
// under test so the static `import { db } from "@/lib/db"` picks up
// the mock.
vi.mock("@/lib/db", () => ({
  db: {
    project: {
      findUnique: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      findMany: vi.fn().mockResolvedValue([]),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    client: {
      findUnique: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      findMany: vi.fn().mockResolvedValue([]),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    contract: { findUnique: vi.fn(), update: vi.fn(), delete: vi.fn(), findMany: vi.fn().mockResolvedValue([]), deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
    quote: { findUnique: vi.fn(), update: vi.fn(), delete: vi.fn(), findMany: vi.fn().mockResolvedValue([]), deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
    supplier: { findUnique: vi.fn(), update: vi.fn(), delete: vi.fn(), findMany: vi.fn().mockResolvedValue([]), deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
    subcontractor: { findUnique: vi.fn(), update: vi.fn(), delete: vi.fn(), findMany: vi.fn().mockResolvedValue([]), deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
    partnership: { findUnique: vi.fn(), update: vi.fn(), delete: vi.fn(), findMany: vi.fn().mockResolvedValue([]), deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
    tool: { findUnique: vi.fn(), update: vi.fn(), delete: vi.fn(), findMany: vi.fn().mockResolvedValue([]), deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
    certification: { findUnique: vi.fn(), update: vi.fn(), delete: vi.fn(), findMany: vi.fn().mockResolvedValue([]), deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
    intranetResource: { findUnique: vi.fn(), update: vi.fn(), delete: vi.fn(), findMany: vi.fn().mockResolvedValue([]), deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
    document: { findUnique: vi.fn(), update: vi.fn(), delete: vi.fn(), findMany: vi.fn().mockResolvedValue([]), deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
    task: { findUnique: vi.fn(), update: vi.fn(), delete: vi.fn(), findMany: vi.fn().mockResolvedValue([]), deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
    vehicle: { findUnique: vi.fn(), update: vi.fn(), delete: vi.fn(), findMany: vi.fn().mockResolvedValue([]), deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
    disciplinaryReport: { findUnique: vi.fn(), update: vi.fn(), delete: vi.fn(), findMany: vi.fn().mockResolvedValue([]), deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
    bidOpportunity: { findUnique: vi.fn(), update: vi.fn(), delete: vi.fn(), findMany: vi.fn().mockResolvedValue([]), deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
    contact: { findUnique: vi.fn(), update: vi.fn(), delete: vi.fn(), findMany: vi.fn().mockResolvedValue([]), deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
  },
}));
vi.mock("@/lib/activity", () => ({
  logActivity: vi.fn(async () => undefined),
}));

import { db } from "@/lib/db";
import { logActivity } from "@/lib/activity";
import {
  SOFT_DELETE_ENTITIES,
  findSoftDeleteEntity,
  softDeleteRow,
  restoreRow,
  hardDeleteRow,
  purgeOldSoftDeletes,
  purgeCutoff,
  DEFAULT_RETENTION_DAYS,
  NOT_DELETED,
} from "./soft-delete";

const projectFindUnique = db.project.findUnique as ReturnType<typeof vi.fn>;
const projectUpdate = db.project.update as ReturnType<typeof vi.fn>;
const projectDelete = db.project.delete as ReturnType<typeof vi.fn>;
const projectDeleteMany = db.project.deleteMany as ReturnType<typeof vi.fn>;

const PROJECT = SOFT_DELETE_ENTITIES.find((e) => e.entityType === "project")!;

describe("soft-delete entity registry", () => {
  it("includes all 16 expected entity types", () => {
    const types = SOFT_DELETE_ENTITIES.map((e) => e.entityType).sort();
    expect(types).toEqual(
      [
        "bid",
        "certification",
        "client",
        "contact",
        "contract",
        "disciplinary-report",
        "document",
        "intranet",
        "partnership",
        "project",
        "quote",
        "subcontractor",
        "supplier",
        "task",
        "tool",
        "vehicle",
      ].sort()
    );
  });

  it("findSoftDeleteEntity resolves by entityType", () => {
    expect(findSoftDeleteEntity("project")?.prismaModel).toBe("project");
    expect(findSoftDeleteEntity("intranet")?.prismaModel).toBe("intranetResource");
    expect(findSoftDeleteEntity("nope")).toBeUndefined();
  });

  it("NOT_DELETED is the literal { deletedAt: null } filter", () => {
    expect(NOT_DELETED).toEqual({ deletedAt: null });
  });
});

describe("softDeleteRow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("stamps deletedAt and logs the activity", async () => {
    projectFindUnique.mockResolvedValue({
      id: "p1",
      deletedAt: null,
      name: "Acme Q1",
    });
    projectUpdate.mockResolvedValue({ id: "p1", name: "Acme Q1" });

    const result = await softDeleteRow(PROJECT, "p1", "u1", {
      scope: { clientId: "c1" },
    });

    expect(result).toEqual({ id: "p1", label: "Acme Q1" });
    expect(projectUpdate).toHaveBeenCalledOnce();
    const updateArgs = projectUpdate.mock.calls[0][0];
    expect(updateArgs.where).toEqual({ id: "p1" });
    expect(updateArgs.data.deletedAt).toBeInstanceOf(Date);
    expect(logActivity).toHaveBeenCalledWith(
      "soft-deleted",
      "project",
      "p1",
      "u1",
      "Acme Q1",
      { clientId: "c1" }
    );
  });

  it("rejects when the row is already soft-deleted", async () => {
    projectFindUnique.mockResolvedValue({
      id: "p1",
      deletedAt: new Date(),
      name: "Acme Q1",
    });
    await expect(softDeleteRow(PROJECT, "p1", "u1")).rejects.toThrow(
      /already in the recovery bin/i
    );
    expect(projectUpdate).not.toHaveBeenCalled();
  });

  it("rejects when the row doesn't exist", async () => {
    projectFindUnique.mockResolvedValue(null);
    await expect(softDeleteRow(PROJECT, "missing", "u1")).rejects.toThrow(
      /not found/i
    );
    expect(projectUpdate).not.toHaveBeenCalled();
  });

  it("can opt out of activity logging", async () => {
    projectFindUnique.mockResolvedValue({ id: "p1", deletedAt: null, name: "x" });
    projectUpdate.mockResolvedValue({ id: "p1", name: "x" });
    await softDeleteRow(PROJECT, "p1", "u1", { log: false });
    expect(logActivity).not.toHaveBeenCalled();
  });
});

describe("restoreRow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("clears deletedAt and logs the restore", async () => {
    projectFindUnique.mockResolvedValue({
      id: "p1",
      deletedAt: new Date("2026-04-01"),
      name: "Acme Q1",
    });
    projectUpdate.mockResolvedValue({ id: "p1", name: "Acme Q1" });

    const result = await restoreRow(PROJECT, "p1", "u1");

    expect(result).toEqual({ id: "p1", label: "Acme Q1" });
    expect(projectUpdate).toHaveBeenCalledWith({
      where: { id: "p1" },
      data: { deletedAt: null },
    });
    expect(logActivity).toHaveBeenCalledWith(
      "restored",
      "project",
      "p1",
      "u1",
      "Acme Q1"
    );
  });

  it("rejects when the row isn't soft-deleted (already restored)", async () => {
    projectFindUnique.mockResolvedValue({
      id: "p1",
      deletedAt: null,
      name: "Acme Q1",
    });
    await expect(restoreRow(PROJECT, "p1", "u1")).rejects.toThrow(
      /already restored/i
    );
  });
});

describe("hardDeleteRow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("hard-deletes when the row exists", async () => {
    projectFindUnique.mockResolvedValue({ id: "p1", name: "Acme" });
    projectDelete.mockResolvedValue({ id: "p1" });

    const result = await hardDeleteRow(PROJECT, "p1", "u1");

    expect(result).toEqual({ deleted: true });
    expect(projectDelete).toHaveBeenCalledWith({ where: { id: "p1" } });
    expect(logActivity).toHaveBeenCalledWith(
      "permanently-deleted",
      "project",
      "p1",
      "u1",
      "Acme"
    );
  });

  it("returns deleted=false on missing row without throwing (cron race)", async () => {
    projectFindUnique.mockResolvedValue(null);
    const result = await hardDeleteRow(PROJECT, "missing", null);
    expect(result).toEqual({ deleted: false });
    expect(projectDelete).not.toHaveBeenCalled();
  });

  it("skips activity log when actorId is null (cron path)", async () => {
    projectFindUnique.mockResolvedValue({ id: "p1", name: "Acme" });
    projectDelete.mockResolvedValue({ id: "p1" });
    await hardDeleteRow(PROJECT, "p1", null);
    expect(logActivity).not.toHaveBeenCalled();
  });
});

describe("purgeCutoff", () => {
  it("returns a date `retentionDays` ago", () => {
    const cutoff = purgeCutoff(30);
    const expected = Date.now() - 30 * 24 * 60 * 60 * 1000;
    // allow up to 1s drift between the call and assertion
    expect(Math.abs(cutoff.getTime() - expected)).toBeLessThan(1000);
  });

  it("defaults to DEFAULT_RETENTION_DAYS", () => {
    const a = purgeCutoff();
    const b = purgeCutoff(DEFAULT_RETENTION_DAYS);
    // Calls 1ms apart — close enough.
    expect(Math.abs(a.getTime() - b.getTime())).toBeLessThan(1000);
  });
});

describe("purgeOldSoftDeletes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls deleteMany on every entity with a cutoff", async () => {
    projectDeleteMany.mockResolvedValue({ count: 3 });
    const summary = await purgeOldSoftDeletes(30);

    // One call per entity in the registry.
    expect(projectDeleteMany).toHaveBeenCalledOnce();
    const args = projectDeleteMany.mock.calls[0][0];
    expect(args.where.deletedAt.lt).toBeInstanceOf(Date);
    expect(summary.find((s) => s.entity === "project")?.purged).toBe(3);
    // one summary row per registry entry
    expect(summary).toHaveLength(SOFT_DELETE_ENTITIES.length);
  });

  it("uses the provided retention window in the cutoff", async () => {
    projectDeleteMany.mockResolvedValue({ count: 0 });
    await purgeOldSoftDeletes(7);
    const cutoff = projectDeleteMany.mock.calls[0][0].where.deletedAt.lt as Date;
    const expected = Date.now() - 7 * 24 * 60 * 60 * 1000;
    expect(Math.abs(cutoff.getTime() - expected)).toBeLessThan(1000);
  });
});
