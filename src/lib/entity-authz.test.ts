/**
 * Tests for assertManageEntity — the write-side counterpart to
 * canViewEntity. The contract (from lib/scope.ts canManageEntity):
 *
 *   - ADMIN / DEVELOPER (org-wide manage) always pass, without even
 *     computing a scope
 *   - MANAGER and CONTRIBUTOR pass only when the entity id is in their
 *     assigned scope set for that entity type
 *   - VIEWER and GUEST never pass, even with the entity in scope
 *     (scope grants them read, not write)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  db: {
    projectMember: { findMany: vi.fn().mockResolvedValue([]) },
    assignment: { findMany: vi.fn().mockResolvedValue([]) },
    entityPermission: { findMany: vi.fn().mockResolvedValue([]) },
    client: { findMany: vi.fn().mockResolvedValue([]) },
    project: { findMany: vi.fn().mockResolvedValue([]) },
    certification: { findMany: vi.fn().mockResolvedValue([]) },
    contract: { findMany: vi.fn().mockResolvedValue([]) },
    projectTool: { findMany: vi.fn().mockResolvedValue([]) },
    vehicle: { findMany: vi.fn().mockResolvedValue([]) },
  },
}));

import { db } from "@/lib/db";
import { assertManageEntity } from "@/lib/entity-authz";

const mocked = vi.mocked;

beforeEach(() => {
  vi.clearAllMocks();
  mocked(db.projectMember.findMany).mockResolvedValue([]);
  mocked(db.assignment.findMany).mockResolvedValue([]);
  mocked(db.entityPermission.findMany).mockResolvedValue([]);
  mocked(db.client.findMany).mockResolvedValue([]);
  mocked(db.project.findMany).mockResolvedValue([]);
  mocked(db.certification.findMany).mockResolvedValue([]);
  mocked(db.contract.findMany).mockResolvedValue([]);
  mocked(db.projectTool.findMany).mockResolvedValue([]);
});

describe("assertManageEntity", () => {
  it("passes ADMIN and DEVELOPER without computing scope", async () => {
    expect(await assertManageEntity("u1", "ADMIN", "project", "p1")).toBeNull();
    expect(await assertManageEntity("u1", "DEVELOPER", "client", "c1")).toBeNull();
    // Org-wide manage short-circuits — no scope queries at all.
    expect(db.assignment.findMany).not.toHaveBeenCalled();
  });

  it("passes a CONTRIBUTOR for a project in their assigned scope", async () => {
    mocked(db.projectMember.findMany).mockResolvedValue([
      { projectId: "p1" } as never,
    ]);
    expect(
      await assertManageEntity("u1", "CONTRIBUTOR", "project", "p1")
    ).toBeNull();
  });

  it("rejects a CONTRIBUTOR for a project outside their scope", async () => {
    mocked(db.projectMember.findMany).mockResolvedValue([
      { projectId: "p1" } as never,
    ]);
    const result = await assertManageEntity(
      "u1",
      "CONTRIBUTOR",
      "project",
      "p-other"
    );
    expect(result).toEqual({
      error: "You don't have access to modify this item",
    });
  });

  it("rejects a MANAGER for an out-of-scope entity despite view-all", async () => {
    // Managers see everything (canViewAll) but write only their
    // assigned set.
    const result = await assertManageEntity("u1", "MANAGER", "contract", "k1");
    expect(result).not.toBeNull();
  });

  it("rejects VIEWER and GUEST even when the entity is in scope", async () => {
    mocked(db.projectMember.findMany).mockResolvedValue([
      { projectId: "p1" } as never,
    ]);
    expect(
      await assertManageEntity("u1", "VIEWER", "project", "p1")
    ).not.toBeNull();
    expect(
      await assertManageEntity("u1", "GUEST", "project", "p1")
    ).not.toBeNull();
  });

  it("uses a precomputed scope without re-querying", async () => {
    const scope = {
      role: "CONTRIBUTOR" as const,
      canViewAll: false,
      canManageAll: false,
      all: false,
      projectIds: new Set(["p1"]),
      clientIds: new Set<string>(),
      contractIds: new Set<string>(),
      toolIds: new Set<string>(),
      certIds: new Set<string>(),
      vehicleIds: new Set<string>(),
    };
    expect(
      await assertManageEntity("u1", "CONTRIBUTOR", "project", "p1", scope)
    ).toBeNull();
    expect(db.projectMember.findMany).not.toHaveBeenCalled();
  });
});
