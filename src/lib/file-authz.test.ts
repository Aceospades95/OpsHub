/**
 * Tests for checkFileReadPermission — the per-entity authz layer that
 * /api/files/[id] runs before serving private file bytes.
 *
 * Coverage matches the R11-C spec scenarios:
 *   (a) owner / admin can read any file
 *   (b) user without project scope gets 403
 *   (c) user with module-level canView but no entity scope gets 403
 *       on entity-scoped parents (project / contract / cert), but
 *       passes for module-level parents (supplier / partnership /
 *       subcontractor / intranet)
 *   (d) every parent FK pointing at a deleted row → 404 (parent_deleted)
 *   (e) genuinely orphan upload → 403 forbidden for everyone except
 *       the uploader / admin
 *
 * The (d) case maps to a 404 in the route handler so a snooping user
 * can't tell whether the parent existed or was deleted.
 *
 * Public-file unauth access is the route handler's concern, not this
 * module's — checkFileReadPermission is only invoked for private
 * files. We don't test that path here.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  db: {
    project: { findUnique: vi.fn() },
    contract: { findUnique: vi.fn() },
    document: { findUnique: vi.fn() },
    supplier: { findUnique: vi.fn() },
    intranetResource: { findUnique: vi.fn() },
    certification: { findUnique: vi.fn() },
    subcontractor: { findUnique: vi.fn() },
    partnership: { findUnique: vi.fn() },
    bidOpportunity: { findUnique: vi.fn() },
    user: { findUnique: vi.fn() },
    quote: { findFirst: vi.fn() },
    workflowDocument: { findFirst: vi.fn() },
  },
}));

vi.mock("@/lib/permissions", () => ({
  resolveModulePerms: vi.fn(),
}));

vi.mock("@/lib/scope", () => ({
  canViewEntity: vi.fn(),
  getUserScope: vi.fn(),
  hasOrgWideManage: vi.fn(),
}));

import { db } from "@/lib/db";
import { resolveModulePerms } from "@/lib/permissions";
import { canViewEntity, getUserScope, hasOrgWideManage } from "@/lib/scope";
import { checkFileReadPermission, type FileAuthzInput } from "./file-authz";

const dbMock = db as unknown as {
  project: { findUnique: ReturnType<typeof vi.fn> };
  contract: { findUnique: ReturnType<typeof vi.fn> };
  document: { findUnique: ReturnType<typeof vi.fn> };
  supplier: { findUnique: ReturnType<typeof vi.fn> };
  intranetResource: { findUnique: ReturnType<typeof vi.fn> };
  certification: { findUnique: ReturnType<typeof vi.fn> };
  subcontractor: { findUnique: ReturnType<typeof vi.fn> };
  partnership: { findUnique: ReturnType<typeof vi.fn> };
  bidOpportunity: { findUnique: ReturnType<typeof vi.fn> };
  user: { findUnique: ReturnType<typeof vi.fn> };
  quote: { findFirst: ReturnType<typeof vi.fn> };
  workflowDocument: { findFirst: ReturnType<typeof vi.fn> };
};

const resolveModulePermsMock = resolveModulePerms as unknown as ReturnType<typeof vi.fn>;
const canViewEntityMock = canViewEntity as unknown as ReturnType<typeof vi.fn>;
const getUserScopeMock = getUserScope as unknown as ReturnType<typeof vi.fn>;
const hasOrgWideManageMock = hasOrgWideManage as unknown as ReturnType<typeof vi.fn>;

function emptyFile(overrides: Partial<FileAuthzInput> = {}): FileAuthzInput {
  return {
    id: "f1",
    uploadedById: "uploader",
    visibility: "private",
    projectId: null,
    contractId: null,
    documentId: null,
    supplierId: null,
    intranetResourceId: null,
    certificationId: null,
    userId: null,
    subcontractorId: null,
    partnershipId: null,
    bidOpportunityId: null,
    ...overrides,
  };
}

function defaultPerms(): {
  canView: boolean;
  canEdit: boolean;
  canCreate: boolean;
  canDelete: boolean;
  canComment: boolean;
  canUpload: boolean;
  canManage: boolean;
} {
  return {
    canView: false,
    canEdit: false,
    canCreate: false,
    canDelete: false,
    canComment: false,
    canUpload: false,
    canManage: false,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  hasOrgWideManageMock.mockReturnValue(false);
  canViewEntityMock.mockReturnValue(false);
  getUserScopeMock.mockResolvedValue({
    role: "VIEWER",
    canViewAll: false,
    canManageAll: false,
    all: false,
    projectIds: new Set<string>(),
    clientIds: new Set<string>(),
    contractIds: new Set<string>(),
    toolIds: new Set<string>(),
    certIds: new Set<string>(),
  });
  resolveModulePermsMock.mockResolvedValue(defaultPerms());
  // Default: every entity lookup returns null.
  for (const [, m] of Object.entries(dbMock)) {
    if ("findUnique" in m) m.findUnique.mockResolvedValue(null);
    if ("findFirst" in m) m.findFirst.mockResolvedValue(null);
  }
});

describe("checkFileReadPermission", () => {
  it("(a) admin / developer always passes via hasOrgWideManage", async () => {
    hasOrgWideManageMock.mockReturnValue(true);
    const result = await checkFileReadPermission(
      "u1",
      "ADMIN",
      emptyFile({ projectId: "p1" })
    );
    expect(result).toEqual({ ok: true });
    // Org-wide-manage is the first short-circuit; no entity lookups.
    expect(dbMock.project.findUnique).not.toHaveBeenCalled();
  });

  it("(a) the uploader can always read their own file, even with no FKs", async () => {
    const result = await checkFileReadPermission(
      "uploader",
      "VIEWER",
      emptyFile()
    );
    expect(result).toEqual({ ok: true });
  });

  it("(b) viewer with no project in scope is forbidden on a project-attached file", async () => {
    dbMock.project.findUnique.mockResolvedValue({ id: "p1", deletedAt: null });
    canViewEntityMock.mockReturnValue(false);
    const result = await checkFileReadPermission(
      "u1",
      "VIEWER",
      emptyFile({ projectId: "p1" })
    );
    expect(result).toEqual({ ok: false, reason: "forbidden" });
  });

  it("(legitimate path) viewer with the project in scope passes", async () => {
    dbMock.project.findUnique.mockResolvedValue({ id: "p1", deletedAt: null });
    canViewEntityMock.mockReturnValue(true);
    const result = await checkFileReadPermission(
      "u1",
      "VIEWER",
      emptyFile({ projectId: "p1" })
    );
    expect(result).toEqual({ ok: true });
    expect(canViewEntityMock).toHaveBeenCalledWith(
      expect.anything(),
      "project",
      "p1"
    );
  });

  it("(c) viewer without suppliers module canView gets 403 on supplier file", async () => {
    dbMock.supplier.findUnique.mockResolvedValue({ id: "s1" });
    resolveModulePermsMock.mockResolvedValue(defaultPerms());
    const result = await checkFileReadPermission(
      "u1",
      "VIEWER",
      emptyFile({ supplierId: "s1" })
    );
    expect(result).toEqual({ ok: false, reason: "forbidden" });
  });

  it("(c-positive) viewer with suppliers module canView passes on supplier file", async () => {
    dbMock.supplier.findUnique.mockResolvedValue({ id: "s1" });
    resolveModulePermsMock.mockResolvedValue({ ...defaultPerms(), canView: true });
    const result = await checkFileReadPermission(
      "u1",
      "VIEWER",
      emptyFile({ supplierId: "s1" })
    );
    expect(result).toEqual({ ok: true });
    expect(resolveModulePermsMock).toHaveBeenCalledWith("u1", "VIEWER", "suppliers");
  });

  it("(d) every parent FK pointing at a deleted row → parent_deleted (route maps to 404)", async () => {
    dbMock.project.findUnique.mockResolvedValue({ id: "p1", deletedAt: new Date() });
    dbMock.contract.findUnique.mockResolvedValue({ id: "c1", deletedAt: new Date() });
    const result = await checkFileReadPermission(
      "u1",
      "VIEWER",
      emptyFile({ projectId: "p1", contractId: "c1" })
    );
    expect(result).toEqual({ ok: false, reason: "parent_deleted" });
  });

  it("(e) orphan upload (no FKs, not the uploader) → forbidden", async () => {
    const result = await checkFileReadPermission(
      "someone-else",
      "VIEWER",
      emptyFile({ uploadedById: "uploader" })
    );
    expect(result).toEqual({ ok: false, reason: "forbidden" });
  });

  it("multi-FK file: passes if ANY parent allows", async () => {
    // Project denies, contract allows.
    dbMock.project.findUnique.mockResolvedValue({ id: "p1", deletedAt: null });
    dbMock.contract.findUnique.mockResolvedValue({ id: "c1", deletedAt: null });
    canViewEntityMock.mockImplementation(
      (_scope, type: string, id: string) => type === "contract" && id === "c1"
    );
    const result = await checkFileReadPermission(
      "u1",
      "VIEWER",
      emptyFile({ projectId: "p1", contractId: "c1" })
    );
    expect(result).toEqual({ ok: true });
  });

  it("user-profile file: only the target user passes (peer denied)", async () => {
    dbMock.user.findUnique.mockResolvedValue({ id: "alice", isActive: true });
    // Peer trying to read alice's resume.
    const peer = await checkFileReadPermission(
      "bob",
      "VIEWER",
      emptyFile({ userId: "alice" })
    );
    expect(peer).toEqual({ ok: false, reason: "forbidden" });

    // Alice herself reading her own file.
    const self = await checkFileReadPermission(
      "alice",
      "VIEWER",
      emptyFile({ userId: "alice" })
    );
    expect(self).toEqual({ ok: true });
  });

  it("indirect parent (Quote.pdfFileId): falls back to quotes-module canView", async () => {
    dbMock.quote.findFirst.mockResolvedValue({ id: "q1", deletedAt: null });
    resolveModulePermsMock.mockResolvedValue({ ...defaultPerms(), canView: true });
    const result = await checkFileReadPermission(
      "u1",
      "VIEWER",
      emptyFile()
    );
    expect(result).toEqual({ ok: true });
    expect(resolveModulePermsMock).toHaveBeenCalledWith("u1", "VIEWER", "quotes");
  });

  it("document file with projectId chains to project scope check", async () => {
    dbMock.document.findUnique.mockResolvedValue({
      id: "doc1",
      projectId: "p1",
      deletedAt: null,
    });
    canViewEntityMock.mockReturnValue(true);
    const result = await checkFileReadPermission(
      "u1",
      "VIEWER",
      emptyFile({ documentId: "doc1" })
    );
    expect(result).toEqual({ ok: true });
    expect(canViewEntityMock).toHaveBeenCalledWith(
      expect.anything(),
      "project",
      "p1"
    );
  });
});
