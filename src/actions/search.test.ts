/**
 * Tests for quickSearch — the cmd-K palette server action.
 *
 * R11-D added per-module canView gates and an entity-scope filter on
 * each bucket. The tests below pin down the behaviour the spec
 * required:
 *
 *  - A user with no module canView for suppliers does NOT receive a
 *    suppliers section, even if rows match the query string.
 *  - An admin sees every section regardless of scope.
 *  - The entity-scope filter is applied in the SQL where clause for
 *    entity-scoped modules (projects / clients / contracts / quotes /
 *    tools), so the DB doesn't need to over-fetch and JS-filter (no
 *    timing leak via filtered count).
 *
 * The test mocks `db`, `requireAuth`, `resolveModulePerms`, and
 * `getUserScope` — the helper itself is intentionally Prisma- and
 * session-pure so this is straightforward unit-testable.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  db: {
    user: { findMany: vi.fn() },
    client: { findMany: vi.fn() },
    project: { findMany: vi.fn() },
    supplier: { findMany: vi.fn() },
    contract: { findMany: vi.fn() },
    quote: { findMany: vi.fn() },
    tool: { findMany: vi.fn() },
    intranetResource: { findMany: vi.fn() },
    vehicle: { findMany: vi.fn() },
    bidOpportunity: { findMany: vi.fn() },
  },
}));
vi.mock("@/lib/permissions", () => ({
  requireAuth: vi.fn(),
  resolveModulePerms: vi.fn(),
}));
vi.mock("@/lib/scope", () => ({
  getUserScope: vi.fn(),
  hasOrgWideManage: vi.fn(),
}));

import { db } from "@/lib/db";
import { requireAuth, resolveModulePerms } from "@/lib/permissions";
import { getUserScope, hasOrgWideManage } from "@/lib/scope";
import { quickSearch } from "./search";

const dbMock = db as unknown as {
  user: { findMany: ReturnType<typeof vi.fn> };
  client: { findMany: ReturnType<typeof vi.fn> };
  project: { findMany: ReturnType<typeof vi.fn> };
  supplier: { findMany: ReturnType<typeof vi.fn> };
  contract: { findMany: ReturnType<typeof vi.fn> };
  quote: { findMany: ReturnType<typeof vi.fn> };
  tool: { findMany: ReturnType<typeof vi.fn> };
  intranetResource: { findMany: ReturnType<typeof vi.fn> };
};
const requireAuthMock = requireAuth as unknown as ReturnType<typeof vi.fn>;
const resolveModulePermsMock = resolveModulePerms as unknown as ReturnType<typeof vi.fn>;
const getUserScopeMock = getUserScope as unknown as ReturnType<typeof vi.fn>;
const hasOrgWideManageMock = hasOrgWideManage as unknown as ReturnType<typeof vi.fn>;

const NO_PERMS = {
  canView: false,
  canEdit: false,
  canCreate: false,
  canDelete: false,
  canComment: false,
  canUpload: false,
  canManage: false,
};

const ALL_PERMS = {
  canView: true,
  canEdit: true,
  canCreate: true,
  canDelete: true,
  canComment: true,
  canUpload: true,
  canManage: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  requireAuthMock.mockResolvedValue({ id: "u1", role: "VIEWER" });
  hasOrgWideManageMock.mockReturnValue(false);
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
    vehicleIds: new Set<string>(),
  });
  resolveModulePermsMock.mockResolvedValue(NO_PERMS);
  // Default: no rows returned anywhere.
  for (const m of Object.values(dbMock)) {
    m.findMany.mockResolvedValue([]);
  }
});

describe("quickSearch authz", () => {
  it("user without suppliers canView gets no supplier results, even if rows would match", async () => {
    // Module gate: only intranet on; suppliers off.
    resolveModulePermsMock.mockImplementation(async (_u, _r, m: string) => {
      if (m === "intranet") return ALL_PERMS;
      return NO_PERMS;
    });
    // The supplier row exists in the DB and would match.
    dbMock.supplier.findMany.mockResolvedValue([
      { id: "s1", name: "Acme Pipes", category: "MEP" },
    ]);

    const { hits } = await quickSearch("acme");

    expect(hits.find((h) => h.type === "supplier")).toBeUndefined();
    // The DB lookup for suppliers should have been skipped entirely
    // — gated buckets shouldn't even touch the DB.
    expect(dbMock.supplier.findMany).not.toHaveBeenCalled();
  });

  it("admin / org-wide-manage sees all sections", async () => {
    requireAuthMock.mockResolvedValue({ id: "admin", role: "ADMIN" });
    hasOrgWideManageMock.mockReturnValue(true);
    resolveModulePermsMock.mockResolvedValue(ALL_PERMS);
    getUserScopeMock.mockResolvedValue({
      role: "ADMIN",
      canViewAll: true,
      canManageAll: true,
      all: true,
      projectIds: new Set<string>(),
      clientIds: new Set<string>(),
      contractIds: new Set<string>(),
      toolIds: new Set<string>(),
      certIds: new Set<string>(),
      vehicleIds: new Set<string>(),
    });
    dbMock.supplier.findMany.mockResolvedValue([
      { id: "s1", name: "Acme Pipes", category: "MEP" },
    ]);
    dbMock.project.findMany.mockResolvedValue([
      { id: "p1", name: "Acme HQ", client: { name: "Acme" } },
    ]);

    const { hits } = await quickSearch("acme");

    expect(hits.find((h) => h.type === "supplier")?.id).toBe("supplier-s1");
    expect(hits.find((h) => h.type === "project")?.id).toBe("project-p1");
  });

  it("non-admin viewer with project canView but empty scope gets empty `id IN ()` filter", async () => {
    resolveModulePermsMock.mockImplementation(async (_u, _r, m: string) => {
      if (m === "projects") return ALL_PERMS;
      return NO_PERMS;
    });
    // Project with restricted-task title exists in DB but viewer has
    // no project in scope.
    dbMock.project.findMany.mockResolvedValue([]);

    const { hits } = await quickSearch("private");

    expect(hits.find((h) => h.type === "project")).toBeUndefined();
    // The scope filter MUST land in the DB query, not in JS, to
    // avoid timing leakage. Verify the where clause carries an
    // `id IN (...)` constraint with the empty set.
    expect(dbMock.project.findMany).toHaveBeenCalledTimes(1);
    const call = dbMock.project.findMany.mock.calls[0][0];
    expect(call.where.AND[0]).toEqual({ id: { in: [] } });
  });

  it("non-admin viewer with project p1 in scope: query carries id IN [p1]", async () => {
    resolveModulePermsMock.mockImplementation(async (_u, _r, m: string) => {
      if (m === "projects") return ALL_PERMS;
      return NO_PERMS;
    });
    getUserScopeMock.mockResolvedValue({
      role: "VIEWER",
      canViewAll: false,
      canManageAll: false,
      all: false,
      projectIds: new Set(["p1"]),
      clientIds: new Set<string>(),
      contractIds: new Set<string>(),
      toolIds: new Set<string>(),
      certIds: new Set<string>(),
      vehicleIds: new Set<string>(),
    });
    dbMock.project.findMany.mockResolvedValue([
      { id: "p1", name: "My project", client: { name: "Acme" } },
    ]);

    const { hits } = await quickSearch("my");

    expect(hits.find((h) => h.type === "project")?.id).toBe("project-p1");
    const call = dbMock.project.findMany.mock.calls[0][0];
    expect(call.where.AND[0]).toEqual({ id: { in: ["p1"] } });
  });

  it("empty query short-circuits — no DB calls", async () => {
    const { hits, truncated } = await quickSearch("   ");
    expect(hits).toEqual([]);
    expect(truncated).toBe(false);
    expect(requireAuthMock).not.toHaveBeenCalled();
  });
});
