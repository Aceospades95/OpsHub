/**
 * Role-default semantics — the July 2026 access rework.
 *
 * These tests pin the deny-by-default field tier: CONTRIBUTOR / VIEWER get
 * NOTHING outside the FIELD_MODULE_DEFAULTS allow-list. The old defaults
 * granted every VIEWER+ canView (and every CONTRIBUTOR+ canEdit) on every
 * module, which exposed quote totals, contract values, and subcontractor
 * rates to field accounts. If a change makes one of the "denied" cases
 * below pass again, that leak is back — don't loosen these without
 * re-reading docs/codebase-audit-2026-07.md §6.
 */

import { describe, it, expect, vi } from "vitest";

// permissions.ts transitively imports next-auth + Prisma via @/lib/auth,
// @/lib/db, and @/lib/scope — mock all three; getRoleDefaults is pure.
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/scope", () => ({
  getUserScope: vi.fn(),
  hasOrgWideManage: (role: string) => role === "ADMIN" || role === "DEVELOPER",
}));

import { getRoleDefaults } from "./permissions";

const FINANCIAL_MODULES = [
  "quotes",
  "contracts",
  "subcontractors",
  "partnerships",
  "suppliers",
  "certifications",
  "workflows",
] as const;

describe("getRoleDefaults — field tier (CONTRIBUTOR)", () => {
  it.each(FINANCIAL_MODULES)("denies %s entirely", (module) => {
    const flags = getRoleDefaults("CONTRIBUTOR", module);
    expect(flags.canView).toBe(false);
    expect(flags.canEdit).toBe(false);
    expect(flags.canCreate).toBe(false);
    expect(flags.canDelete).toBe(false);
  });

  it("grants full task workflow", () => {
    const flags = getRoleDefaults("CONTRIBUTOR", "tasks");
    expect(flags.canView).toBe(true);
    expect(flags.canEdit).toBe(true);
    expect(flags.canCreate).toBe(true);
    expect(flags.canDelete).toBe(false);
  });

  it("grants scoped project view + comment + upload, but not edit", () => {
    const flags = getRoleDefaults("CONTRIBUTOR", "projects");
    expect(flags.canView).toBe(true);
    expect(flags.canComment).toBe(true);
    expect(flags.canUpload).toBe(true);
    expect(flags.canEdit).toBe(false);
    expect(flags.canCreate).toBe(false);
  });

  it("grants client + team + intranet + tools view", () => {
    for (const module of ["clients", "team", "intranet", "tools"]) {
      expect(getRoleDefaults("CONTRIBUTOR", module).canView).toBe(true);
      expect(getRoleDefaults("CONTRIBUTOR", module).canEdit).toBe(false);
    }
  });
});

describe("getRoleDefaults — legacy VIEWER is the read-only field variant", () => {
  it("can view allow-listed modules but write nothing", () => {
    expect(getRoleDefaults("VIEWER", "tasks").canView).toBe(true);
    expect(getRoleDefaults("VIEWER", "tasks").canEdit).toBe(false);
    expect(getRoleDefaults("VIEWER", "tasks").canCreate).toBe(false);
    expect(getRoleDefaults("VIEWER", "projects").canView).toBe(true);
    expect(getRoleDefaults("VIEWER", "projects").canUpload).toBe(false);
  });

  it.each(FINANCIAL_MODULES)("denies %s entirely", (module) => {
    expect(getRoleDefaults("VIEWER", module).canView).toBe(false);
  });
});

describe("getRoleDefaults — MANAGER keeps org-wide operational access", () => {
  it("gets everything except canManage on every module", () => {
    for (const module of ["quotes", "contracts", "projects", "team"]) {
      const flags = getRoleDefaults("MANAGER", module);
      expect(flags.canView).toBe(true);
      expect(flags.canEdit).toBe(true);
      expect(flags.canDelete).toBe(true);
      expect(flags.canManage).toBe(false);
    }
  });
});

describe("getRoleDefaults — GUEST unchanged", () => {
  it("sees only the guest allow-list, read-only", () => {
    expect(getRoleDefaults("GUEST", "intranet").canView).toBe(true);
    expect(getRoleDefaults("GUEST", "team").canView).toBe(true);
    expect(getRoleDefaults("GUEST", "quotes").canView).toBe(false);
    expect(getRoleDefaults("GUEST", "intranet").canEdit).toBe(false);
  });
});
