import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock @/lib/db so the module-level import (sampleRows/exportRows)
// doesn't instantiate a real PrismaClient; commit() uses ctx.db.
vi.mock("@/lib/db", () => ({
  db: {
    client: { findMany: vi.fn() },
    serviceOffering: { findMany: vi.fn() },
    project: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    activityLog: { create: vi.fn() },
  },
}));

import { db } from "@/lib/db";
import { projectsImporter } from "./projects";
import type { ImportContext, ImportMode } from "../types";

const clientFindMany = db.client.findMany as ReturnType<typeof vi.fn>;
const offeringFindMany = db.serviceOffering.findMany as ReturnType<typeof vi.fn>;
const projectFindMany = db.project.findMany as ReturnType<typeof vi.fn>;
const projectCreate = db.project.create as ReturnType<typeof vi.fn>;
const projectUpdate = db.project.update as ReturnType<typeof vi.fn>;

function mkCtx(mode: ImportMode): ImportContext {
  return {
    triggeredBy: "admin-1",
    mode,
    db: db as unknown as ImportContext["db"],
  };
}

type DbProject = { id: string; name: string; clientId: string; deletedAt: Date | null };
const live = (id: string, name: string, clientId: string): DbProject => ({
  id,
  name,
  clientId,
  deletedAt: null,
});

describe("projects importer commit() — dedupe matrix", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clientFindMany.mockResolvedValue([
      { id: "cl1", name: "Acme Corp" },
      { id: "cl2", name: "Globex" },
    ]);
    offeringFindMany.mockResolvedValue([]);
    projectCreate.mockImplementation(async ({ data }) => ({ id: "p-new", ...data }));
    projectUpdate.mockImplementation(async ({ where, data }) => ({ ...where, ...data }));
  });

  it("exact duplicate (same client): create mode skips ('already exists'), upsert updates", async () => {
    projectFindMany.mockResolvedValue([live("p1", "Site Build", "cl1")]);

    const createRun = await projectsImporter.commit(
      [{ name: "Site Build", clientName: "Acme Corp" }],
      mkCtx("create")
    );
    expect(createRun.skipped).toBe(1);
    expect(createRun.rows[0].message).toContain("already exists");
    expect(projectCreate).not.toHaveBeenCalled();

    const upsertRun = await projectsImporter.commit(
      [{ name: "site build", clientName: "Acme Corp" }],
      mkCtx("upsert")
    );
    expect(upsertRun.updated).toBe(1);
    expect(projectUpdate).toHaveBeenCalledOnce();
    expect(projectUpdate.mock.calls[0][0].where).toEqual({ id: "p1" });
  });

  it("case/space/punctuation variant in create mode: skipped as possible duplicate", async () => {
    projectFindMany.mockResolvedValue([live("p1", "Site Build", "cl1")]);

    const result = await projectsImporter.commit(
      [{ name: "SITE  Build.", clientName: "Acme Corp" }], // exact key differs, normalized matches
      mkCtx("create")
    );

    expect(result.skipped).toBe(1);
    expect(result.imported).toBe(0);
    expect(result.rows[0].message).toContain('Possible duplicate of "Site Build"');
    expect(projectCreate).not.toHaveBeenCalled();
  });

  it("variant in upsert mode: created anyway, with a possible-duplicate warning", async () => {
    projectFindMany.mockResolvedValue([live("p1", "Site Build", "cl1")]);

    const result = await projectsImporter.commit(
      [{ name: "Site  Build.", clientName: "Acme Corp" }],
      mkCtx("upsert")
    );

    expect(result.imported).toBe(1);
    expect(result.warnings).toBe(1);
    expect((result.rows[0].warnings ?? []).join(" ")).toContain("Possible duplicate");
    expect(projectCreate).toHaveBeenCalledOnce();
    expect(projectUpdate).not.toHaveBeenCalled();
  });

  it("same normalized name under a DIFFERENT client is not a duplicate", async () => {
    projectFindMany.mockResolvedValue([live("p1", "Site Build", "cl1")]);

    const result = await projectsImporter.commit(
      [{ name: "Site  Build.", clientName: "Globex" }],
      mkCtx("create")
    );

    expect(result.imported).toBe(1);
    expect(result.skipped).toBe(0);
    expect(result.warnings).toBe(0);
  });

  it("distinct names on the same client create cleanly", async () => {
    projectFindMany.mockResolvedValue([live("p1", "Site Build", "cl1")]);

    const result = await projectsImporter.commit(
      [
        { name: "Network Refresh", clientName: "Acme Corp" },
        { name: "Security Audit", clientName: "Acme Corp" },
      ],
      mkCtx("create")
    );

    expect(result.imported).toBe(2);
    expect(result.skipped).toBe(0);
    expect(result.warnings).toBe(0);
  });

  it("in-file normalized duplicate in create mode: second row skipped as possible duplicate", async () => {
    projectFindMany.mockResolvedValue([]);

    const result = await projectsImporter.commit(
      [
        { name: "Network Refresh", clientName: "Acme Corp" },
        { name: "network  refresh.", clientName: "Acme Corp" }, // variant of row 1
      ],
      mkCtx("create")
    );

    expect(result.imported).toBe(1);
    expect(result.skipped).toBe(1);
    expect(result.rows[1].message).toContain('Possible duplicate of "Network Refresh"');
    expect(projectCreate).toHaveBeenCalledOnce();
  });

  it("in-file EXACT duplicate in create mode keeps the 'already exists' skip", async () => {
    projectFindMany.mockResolvedValue([]);

    const result = await projectsImporter.commit(
      [
        { name: "Network Refresh", clientName: "Acme Corp" },
        { name: "network refresh", clientName: "Acme Corp" }, // same exact key (lowercased)
      ],
      mkCtx("create")
    );

    expect(result.imported).toBe(1);
    expect(result.skipped).toBe(1);
    expect(result.rows[1].message).toContain("already exists");
  });

  it("soft-deleted projects never flag a possible duplicate", async () => {
    projectFindMany.mockResolvedValue([
      { id: "p1", name: "Site Build", clientId: "cl1", deletedAt: new Date("2026-01-01") },
    ]);

    const result = await projectsImporter.commit(
      [{ name: "Site  Build.", clientName: "Acme Corp" }],
      mkCtx("create")
    );

    expect(result.imported).toBe(1);
    expect(result.skipped).toBe(0);
    expect(result.warnings).toBe(0);
  });

  it("unknown client still fails the row (guardrail does not change FK errors)", async () => {
    projectFindMany.mockResolvedValue([]);

    const result = await projectsImporter.commit(
      [{ name: "Site Build", clientName: "Nobody Inc" }],
      mkCtx("create")
    );

    expect(result.failed).toBe(1);
    expect(result.rows[0].message).toContain("Client not found");
  });
});
