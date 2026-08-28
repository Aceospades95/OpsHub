import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock @/lib/db so the module-level import (sampleRows/exportRows)
// doesn't instantiate a real PrismaClient; commit() uses ctx.db.
vi.mock("@/lib/db", () => ({
  db: {
    client: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    user: { findMany: vi.fn() },
    activityLog: { create: vi.fn() },
  },
}));

import { db } from "@/lib/db";
import { clientsImporter, normalizeImportName } from "./clients";
import type { ImportContext, ImportMode } from "../types";

const clientFindMany = db.client.findMany as ReturnType<typeof vi.fn>;
const clientCreate = db.client.create as ReturnType<typeof vi.fn>;
const clientUpdate = db.client.update as ReturnType<typeof vi.fn>;
const userFindMany = db.user.findMany as ReturnType<typeof vi.fn>;

function mkCtx(mode: ImportMode): ImportContext {
  return {
    triggeredBy: "admin-1",
    mode,
    db: db as unknown as ImportContext["db"],
  };
}

type DbClient = { id: string; name: string; deletedAt: Date | null };
const live = (id: string, name: string): DbClient => ({ id, name, deletedAt: null });

describe("normalizeImportName", () => {
  it("lowercases, trims, and collapses internal whitespace", () => {
    expect(normalizeImportName("  Acme   Corp  ")).toBe("acme corp");
    expect(normalizeImportName("ACME CORP")).toBe("acme corp");
  });

  it("strips trailing punctuation runs (with or without spaces)", () => {
    expect(normalizeImportName("Acme Corp.")).toBe("acme corp");
    expect(normalizeImportName("Acme Corp ,.")).toBe("acme corp");
    expect(normalizeImportName("Acme Corp —")).toBe("acme corp");
  });

  it("keeps internal punctuation — only the tail is stripped", () => {
    expect(normalizeImportName("A.B. Consulting")).toBe("a.b. consulting");
  });

  it("returns empty string for whitespace/punctuation-only input", () => {
    expect(normalizeImportName("  ")).toBe("");
    expect(normalizeImportName("...")).toBe("");
  });
});

describe("clients importer commit() — dedupe matrix", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    userFindMany.mockResolvedValue([]);
    clientCreate.mockImplementation(async ({ data }) => ({ id: "c-new", ...data }));
    clientUpdate.mockImplementation(async ({ where, data }) => ({ ...where, ...data }));
  });

  it("exact duplicate: create mode skips ('already exists'), upsert updates", async () => {
    clientFindMany.mockResolvedValue([live("c1", "Acme Corp")]);

    const createRun = await clientsImporter.commit([{ name: "Acme Corp" }], mkCtx("create"));
    expect(createRun.skipped).toBe(1);
    expect(createRun.rows[0].message).toContain("already exists");
    expect(clientCreate).not.toHaveBeenCalled();

    const upsertRun = await clientsImporter.commit([{ name: "acme corp" }], mkCtx("upsert"));
    expect(upsertRun.updated).toBe(1);
    expect(clientUpdate).toHaveBeenCalledOnce();
    expect(clientUpdate.mock.calls[0][0].where).toEqual({ id: "c1" });
  });

  it("case/space/punctuation variant in create mode: skipped as possible duplicate", async () => {
    clientFindMany.mockResolvedValue([live("c1", "Acme Corp")]);

    const result = await clientsImporter.commit(
      [{ name: "ACME  Corp." }], // exact key differs, normalized key matches
      mkCtx("create")
    );

    expect(result.skipped).toBe(1);
    expect(result.imported).toBe(0);
    expect(result.rows[0].message).toContain('Possible duplicate of "Acme Corp"');
    expect(clientCreate).not.toHaveBeenCalled();
  });

  it("variant in upsert mode: created anyway, with a possible-duplicate warning", async () => {
    clientFindMany.mockResolvedValue([live("c1", "Acme Corp")]);

    const result = await clientsImporter.commit([{ name: "Acme  Corp." }], mkCtx("upsert"));

    expect(result.imported).toBe(1);
    expect(result.warnings).toBe(1);
    expect((result.rows[0].warnings ?? []).join(" ")).toContain("Possible duplicate");
    expect(clientCreate).toHaveBeenCalledOnce();
    expect(clientUpdate).not.toHaveBeenCalled();
  });

  it("distinct names create cleanly with no duplicate flags", async () => {
    clientFindMany.mockResolvedValue([live("c1", "Acme Corp")]);

    const result = await clientsImporter.commit(
      [{ name: "Globex" }, { name: "Initech" }],
      mkCtx("create")
    );

    expect(result.imported).toBe(2);
    expect(result.skipped).toBe(0);
    expect(result.warnings).toBe(0);
    expect(clientCreate).toHaveBeenCalledTimes(2);
  });

  it("in-file exact duplicate keeps the existing 'Duplicate row in file' skip", async () => {
    clientFindMany.mockResolvedValue([]);

    const result = await clientsImporter.commit(
      [{ name: "Globex" }, { name: "globex" }],
      mkCtx("create")
    );

    expect(result.imported).toBe(1);
    expect(result.skipped).toBe(1);
    expect(result.rows[1].message).toContain("Duplicate row in file");
  });

  it("in-file NORMALIZED duplicate in create mode: second row skipped as possible duplicate", async () => {
    clientFindMany.mockResolvedValue([]);

    const result = await clientsImporter.commit(
      [{ name: "Globex" }, { name: "Globex." }], // different exact keys, same normalized key
      mkCtx("create")
    );

    expect(result.imported).toBe(1);
    expect(result.skipped).toBe(1);
    expect(result.rows[1].message).toContain('Possible duplicate of "Globex"');
    expect(clientCreate).toHaveBeenCalledOnce();
  });

  it("soft-deleted clients never flag a possible duplicate", async () => {
    clientFindMany.mockResolvedValue([
      { id: "c1", name: "Acme Corp", deletedAt: new Date("2026-01-01") },
    ]);

    const result = await clientsImporter.commit([{ name: "Acme  Corp." }], mkCtx("create"));

    expect(result.imported).toBe(1);
    expect(result.skipped).toBe(0);
    expect(result.warnings).toBe(0);
  });

  it("update mode still skips non-matches with the 'no existing record' message", async () => {
    clientFindMany.mockResolvedValue([]);

    const result = await clientsImporter.commit([{ name: "Globex" }], mkCtx("update"));

    expect(result.skipped).toBe(1);
    expect(result.rows[0].message).toContain("no existing record");
    expect(clientCreate).not.toHaveBeenCalled();
  });
});
