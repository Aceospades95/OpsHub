import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock @/lib/db before importing the module under test so the
// importer's static `import { db } from "@/lib/db"` (used by
// sampleRows/exportRows) picks up the mock instead of instantiating a
// real PrismaClient. commit() itself receives the client via ctx.db —
// we pass the same mock object there.
vi.mock("@/lib/db", () => ({
  db: {
    user: { findMany: vi.fn() },
    project: { findMany: vi.fn() },
    client: { findMany: vi.fn() },
    task: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    activityLog: { create: vi.fn() },
  },
}));

import { db } from "@/lib/db";
import { tasksImporter } from "./tasks";
import type { ImportContext, ImportMode } from "../types";

const userFindMany = db.user.findMany as ReturnType<typeof vi.fn>;
const projectFindMany = db.project.findMany as ReturnType<typeof vi.fn>;
const clientFindMany = db.client.findMany as ReturnType<typeof vi.fn>;
const taskFindMany = db.task.findMany as ReturnType<typeof vi.fn>;
const taskCreate = db.task.create as ReturnType<typeof vi.fn>;
const taskUpdate = db.task.update as ReturnType<typeof vi.fn>;

/** Build an ImportContext whose ctx.db is the shared mock client. */
function mkCtx(mode: ImportMode): ImportContext {
  return {
    triggeredBy: "u1",
    mode,
    db: db as unknown as ImportContext["db"],
  };
}

describe("tasks importer commit()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    userFindMany.mockResolvedValue([
      { id: "u1", email: "alice@example.com" },
    ]);
    projectFindMany.mockResolvedValue([
      { id: "p1", name: "Marketing Site" },
    ]);
    clientFindMany.mockResolvedValue([
      { id: "c1", name: "Acme Corp" },
    ]);
  });

  it("creates new tasks in create mode when no existing match", async () => {
    taskFindMany.mockResolvedValue([]);
    taskCreate.mockResolvedValue({
      id: "t1",
      title: "New task",
      projectId: "p1",
      clientId: "c1",
    });

    const result = await tasksImporter.commit(
      [
        {
          title: "New task",
          projectName: "Marketing Site",
          clientName: "Acme Corp",
        },
      ],
      mkCtx("create")
    );

    expect(result.imported).toBe(1);
    expect(result.updated).toBe(0);
    expect(result.skipped).toBe(0);
    expect(taskCreate).toHaveBeenCalledOnce();
    expect(taskUpdate).not.toHaveBeenCalled();
  });

  it("skips existing rows in create mode (the QA-reported bug)", async () => {
    // Pre-seed: a task with this exact (title, project, client) already
    // exists. In create mode this should be SKIPPED, not duplicated.
    taskFindMany.mockResolvedValue([
      {
        id: "t-existing",
        title: "StressTestTaskA",
        projectId: "p1",
        clientId: "c1",
      },
    ]);

    const result = await tasksImporter.commit(
      [
        {
          title: "StressTestTaskA",
          projectName: "Marketing Site",
          clientName: "Acme Corp",
        },
      ],
      mkCtx("create")
    );

    expect(result.imported).toBe(0);
    expect(result.updated).toBe(0);
    expect(result.skipped).toBe(1);
    expect(taskCreate).not.toHaveBeenCalled();
    expect(taskUpdate).not.toHaveBeenCalled();
    expect(result.rows[0].status).toBe("skipped");
    expect(result.rows[0].message).toContain("already exists");
  });

  it("updates existing rows in upsert mode", async () => {
    taskFindMany.mockResolvedValue([
      {
        id: "t-existing",
        title: "StressTestTaskA",
        projectId: "p1",
        clientId: "c1",
      },
    ]);
    taskUpdate.mockResolvedValue({
      id: "t-existing",
      title: "StressTestTaskA",
      projectId: "p1",
      clientId: "c1",
    });

    const result = await tasksImporter.commit(
      [
        {
          title: "StressTestTaskA",
          projectName: "Marketing Site",
          clientName: "Acme Corp",
          priority: "HIGH",
        },
      ],
      mkCtx("upsert")
    );

    expect(result.imported).toBe(0);
    expect(result.updated).toBe(1);
    expect(result.skipped).toBe(0);
    expect(taskUpdate).toHaveBeenCalledOnce();
    expect(taskCreate).not.toHaveBeenCalled();
  });

  it("matches case-insensitively across title, project, and client", async () => {
    taskFindMany.mockResolvedValue([
      {
        id: "t-existing",
        title: "StressTestTaskA",
        projectId: "p1",
        clientId: "c1",
      },
    ]);
    taskUpdate.mockResolvedValue({
      id: "t-existing",
      title: "stresstesttaska",
      projectId: "p1",
      clientId: "c1",
    });

    const result = await tasksImporter.commit(
      [
        {
          // Different casing on every match-key field; should still match.
          title: "stresstesttaska",
          projectName: "MARKETING SITE",
          clientName: "acme corp",
        },
      ],
      mkCtx("upsert")
    );

    expect(result.updated).toBe(1);
    expect(result.imported).toBe(0);
  });

  it("treats unscoped tasks (no project/client) as matchable by title alone", async () => {
    taskFindMany.mockResolvedValue([
      {
        id: "t-existing",
        title: "Personal todo",
        projectId: null,
        clientId: null,
      },
    ]);
    taskUpdate.mockResolvedValue({
      id: "t-existing",
      title: "Personal todo",
      projectId: null,
      clientId: null,
    });

    const result = await tasksImporter.commit(
      [{ title: "Personal todo" }],
      mkCtx("upsert")
    );

    expect(result.updated).toBe(1);
    expect(result.imported).toBe(0);
  });

  it("does not re-import the same task twice in one file", async () => {
    taskFindMany.mockResolvedValue([]);
    taskCreate.mockResolvedValue({
      id: "t1",
      title: "Dup task",
      projectId: "p1",
      clientId: "c1",
    });

    const result = await tasksImporter.commit(
      [
        {
          title: "Dup task",
          projectName: "Marketing Site",
          clientName: "Acme Corp",
        },
        {
          title: "Dup task",
          projectName: "Marketing Site",
          clientName: "Acme Corp",
        },
      ],
      mkCtx("create")
    );

    expect(result.imported).toBe(1);
    expect(result.skipped).toBe(1);
    expect(result.rows[1].message).toContain("Duplicate row in file");
  });

  it("re-upload matches by resolved state when CSV project name does NOT resolve (regression: round-4 QA P0-1)", async () => {
    // Repro: a CSV row carries projectName="Ghost Project" / clientName="Ghost Co"
    // that don't exist in the DB. First upload creates a task with
    // projectId=null/clientId=null. Second upload must recognize the
    // prior row and update (or skip), not create a duplicate.
    //
    // Pre-bug: CSV-side key was built from the raw "Ghost Project" /
    // "Ghost Co" strings while the DB-side key for the inserted row
    // was built from null/null — the two keys never matched.
    taskFindMany.mockResolvedValue([
      {
        id: "t-existing",
        title: "Orphan task",
        projectId: null,
        clientId: null,
      },
    ]);
    taskUpdate.mockResolvedValue({
      id: "t-existing",
      title: "Orphan task",
      projectId: null,
      clientId: null,
    });

    const result = await tasksImporter.commit(
      [
        {
          title: "Orphan task",
          projectName: "Ghost Project", // not in DB
          clientName: "Ghost Co", // not in DB
        },
      ],
      mkCtx("upsert")
    );

    expect(result.imported).toBe(0);
    expect(result.updated).toBe(1);
    expect(result.skipped).toBe(0);
    expect(taskCreate).not.toHaveBeenCalled();
    expect(taskUpdate).toHaveBeenCalledOnce();
  });

  it("re-uploading the same CSV in upsert mode produces 0 created, N updated", async () => {
    // Simulates the QA repro: import 2 rows, then re-upload the exact
    // same CSV. In create mode this would create duplicates; in upsert
    // mode it should report 0 created, 2 updated.
    taskFindMany.mockResolvedValue([
      {
        id: "t-a",
        title: "StressTestTaskA",
        projectId: "p1",
        clientId: "c1",
      },
      {
        id: "t-b",
        title: "StressTestTaskB",
        projectId: "p1",
        clientId: "c1",
      },
    ]);
    taskUpdate.mockImplementation(async ({ where }) => ({
      id: where.id,
      title: "x",
      projectId: "p1",
      clientId: "c1",
    }));

    const result = await tasksImporter.commit(
      [
        {
          title: "StressTestTaskA",
          projectName: "Marketing Site",
          clientName: "Acme Corp",
        },
        {
          title: "StressTestTaskB",
          projectName: "Marketing Site",
          clientName: "Acme Corp",
        },
      ],
      mkCtx("upsert")
    );

    expect(result.imported).toBe(0);
    expect(result.updated).toBe(2);
    expect(result.skipped).toBe(0);
    expect(result.failed).toBe(0);
  });
});

describe("tasks importer metadata", () => {
  it("declares supportsUpsert with a user-readable match-key description", () => {
    expect(tasksImporter.supportsUpsert).toBe(true);
    expect(tasksImporter.upsertKeyDescription).toBeTruthy();
    expect(tasksImporter.upsertKeyDescription).toMatch(/title/i);
    expect(tasksImporter.upsertKeyDescription).toMatch(/project/i);
    expect(tasksImporter.upsertKeyDescription).toMatch(/client/i);
  });
});
