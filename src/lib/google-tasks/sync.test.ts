/**
 * Google Tasks sync — list-fidelity behavior with the Google API and
 * Prisma fully mocked. Covers the multi-list pull (mirror upsert +
 * per-list task stamping), deleted-list cleanup, legacy-key migration
 * stamping, subtask parent/position stamping (create, update, metadata
 * patch, alias-pin — including clearing on promotion to top level),
 * and the destination-list handling of pushNewTaskToGoogle.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  db: {
    googleTasksIntegration: { findUnique: vi.fn(), update: vi.fn() },
    googleTaskList: {
      upsert: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      delete: vi.fn(),
    },
    task: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
  },
}));
vi.mock("./api", () => ({
  getValidAccessToken: vi.fn(),
  listTasklists: vi.fn(),
  listTasks: vi.fn(),
  getDefaultTasklist: vi.fn(),
  patchTask: vi.fn(),
  insertTask: vi.fn(),
}));
vi.mock("@/lib/log", () => ({
  log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("@/lib/revalidate-entity", () => ({
  revalidateTask: vi.fn(),
}));

import { db } from "@/lib/db";
import {
  getDefaultTasklist,
  getValidAccessToken,
  insertTask,
  listTasklists,
  listTasks,
  patchTask,
} from "./api";
import { pushNewTaskToGoogle, syncGoogleTasksForUser } from "./sync";

const integrationFind = db.googleTasksIntegration.findUnique as ReturnType<typeof vi.fn>;
const integrationUpdate = db.googleTasksIntegration.update as ReturnType<typeof vi.fn>;
const listUpsert = db.googleTaskList.upsert as ReturnType<typeof vi.fn>;
const listFindMany = db.googleTaskList.findMany as ReturnType<typeof vi.fn>;
const listFindUnique = db.googleTaskList.findUnique as ReturnType<typeof vi.fn>;
const listDelete = db.googleTaskList.delete as ReturnType<typeof vi.fn>;
const taskFindFirst = db.task.findFirst as ReturnType<typeof vi.fn>;
const taskFindMany = db.task.findMany as ReturnType<typeof vi.fn>;
const taskCreate = db.task.create as ReturnType<typeof vi.fn>;
const taskUpdate = db.task.update as ReturnType<typeof vi.fn>;
const taskUpdateMany = db.task.updateMany as ReturnType<typeof vi.fn>;
const mockedToken = getValidAccessToken as ReturnType<typeof vi.fn>;
const mockedLists = listTasklists as ReturnType<typeof vi.fn>;
const mockedTasks = listTasks as ReturnType<typeof vi.fn>;
const mockedDefault = getDefaultTasklist as ReturnType<typeof vi.fn>;
const mockedInsert = insertTask as ReturnType<typeof vi.fn>;
const mockedPatch = patchTask as ReturnType<typeof vi.fn>;

const INTEGRATION = {
  id: "int-1",
  userId: "u-1",
  refreshToken: "r",
  accessToken: "a",
  accessTokenExpiresAt: null,
  tasklistId: null,
  lastSyncedAt: null,
  fullPulledAt: new Date("2026-07-01T00:00:00Z"),
  lastSyncStatus: null,
  lastSyncError: null,
  autoSyncMinutes: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  integrationFind.mockResolvedValue(INTEGRATION);
  integrationUpdate.mockResolvedValue({});
  mockedToken.mockResolvedValue("token");
  mockedDefault.mockResolvedValue({ id: "list-default", title: "My Tasks" });
  listUpsert.mockResolvedValue({});
  listFindMany.mockResolvedValue([]);
  listDelete.mockResolvedValue({});
  taskFindFirst.mockResolvedValue(null);
  taskFindMany.mockResolvedValue([]);
  taskCreate.mockResolvedValue({ id: "t-new" });
  taskUpdate.mockResolvedValue({});
  taskUpdateMany.mockResolvedValue({ count: 0 });
});

describe("multi-list pull", () => {
  it("mirrors every list (title + default flag) and stamps tasks with their list id", async () => {
    mockedLists.mockResolvedValue([
      { id: "list-default", title: "My Tasks" },
      { id: "list-b", title: "Site visits" },
    ]);
    mockedTasks.mockImplementation(async (_t: string, listId: string) =>
      listId === "list-default"
        ? [{ id: "g1", title: "Buy cones", status: "needsAction", updated: "2026-07-18T00:00:00Z" }]
        : [{ id: "g2", title: "Walk site 4", status: "needsAction", updated: "2026-07-18T00:00:00Z" }]
    );

    const result = await syncGoogleTasksForUser("u-1");

    expect(result.errors).toEqual([]);
    expect(result.pulledCreated).toBe(2);
    // Mirror rows: one per list, default flagged, titles carried.
    expect(listUpsert).toHaveBeenCalledTimes(2);
    const upserts = listUpsert.mock.calls.map((c) => c[0].create);
    expect(upserts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ listId: "list-default", title: "My Tasks", isDefault: true }),
        expect.objectContaining({ listId: "list-b", title: "Site visits", isDefault: false }),
      ])
    );
    // Tasks carry composite key AND the denormalized googleListId.
    const creates = taskCreate.mock.calls.map((c) => c[0].data);
    expect(creates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sourceId: "list-default:g1", googleListId: "list-default" }),
        expect.objectContaining({ sourceId: "list-b:g2", googleListId: "list-b" }),
      ])
    );
  });

  it("soft-deletes tasks of a list deleted in Google and drops its mirror row", async () => {
    mockedLists.mockResolvedValue([{ id: "list-default", title: "My Tasks" }]);
    mockedTasks.mockResolvedValue([]);
    // The mirror remembers a list the account no longer has.
    listFindMany.mockResolvedValue([
      { id: "row-gone", userId: "u-1", listId: "list-gone", title: "Old list" },
    ]);
    taskUpdateMany.mockResolvedValue({ count: 3 });

    const result = await syncGoogleTasksForUser("u-1");

    expect(result.errors).toEqual([]);
    expect(taskUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          sourceId: { startsWith: "list-gone:" },
          deletedAt: null,
        }),
        data: { deletedAt: expect.any(Date) },
      })
    );
    expect(listDelete).toHaveBeenCalledWith({ where: { id: "row-gone" } });
  });

  it("stamps googleListId when migrating a legacy bare-id row (metadata patch path)", async () => {
    mockedLists.mockResolvedValue([{ id: "list-default", title: "My Tasks" }]);
    mockedTasks.mockResolvedValue([
      { id: "g9", title: "Legacy", status: "needsAction", updated: "2026-06-01T00:00:00Z" },
    ]);
    // Existing row matched by bare legacy id; OpsHub row is NEWER than
    // Google's edit so only metadata migrates.
    taskFindFirst.mockResolvedValue({
      id: "t-9",
      title: "Legacy",
      description: null,
      status: "TODO",
      dueDate: null,
      deletedAt: null,
      updatedAt: new Date("2026-07-10T00:00:00Z"),
      sourceId: "g9",
      sourceLink: null,
      sourceReadOnly: false,
      googleListId: null,
    });

    await syncGoogleTasksForUser("u-1");

    expect(taskUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "t-9" },
        data: expect.objectContaining({
          sourceId: "list-default:g9",
          googleListId: "list-default",
        }),
      })
    );
  });
});

describe("subtask parent + position stamping", () => {
  /** Everything the pull's update/meta paths read off an existing row. */
  const existingRow = (over: Record<string, unknown>) => ({
    id: "t-1",
    title: "Same",
    description: null,
    status: "TODO",
    dueDate: null,
    completedAt: null,
    deletedAt: null,
    updatedAt: new Date("2026-07-01T00:00:00Z"),
    sourceId: "list-default:g1",
    sourceLink: null,
    sourceReadOnly: false,
    googleListId: "list-default",
    googleParentId: null,
    googlePosition: null,
    ...over,
  });

  beforeEach(() => {
    mockedLists.mockResolvedValue([{ id: "list-default", title: "My Tasks" }]);
  });

  it("stamps parent + position on create, nulls for top-level tasks", async () => {
    mockedTasks.mockResolvedValue([
      {
        id: "g-parent",
        title: "Parent",
        status: "needsAction",
        updated: "2026-07-18T00:00:00Z",
        position: "00000000000000000001",
      },
      {
        id: "g-child",
        title: "Child",
        status: "needsAction",
        updated: "2026-07-18T00:00:00Z",
        parent: "g-parent",
        position: "00000000000000000000",
      },
    ]);

    const result = await syncGoogleTasksForUser("u-1");

    expect(result.errors).toEqual([]);
    const creates = taskCreate.mock.calls.map((c) => c[0].data);
    expect(creates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceId: "list-default:g-parent",
          googleParentId: null,
          googlePosition: "00000000000000000001",
        }),
        expect.objectContaining({
          sourceId: "list-default:g-child",
          googleParentId: "g-parent",
          googlePosition: "00000000000000000000",
        }),
      ])
    );
  });

  it("mirrors a pure move (parent/position only) through the update path", async () => {
    // Content identical on both sides — the reparent/reorder alone must
    // count as "changed" and land on the row.
    mockedTasks.mockResolvedValue([
      {
        id: "g1",
        title: "Same",
        status: "needsAction",
        updated: "2026-07-18T00:00:00Z",
        parent: "g-parent",
        position: "00000000000000000002",
      },
    ]);
    taskFindFirst.mockResolvedValue(existingRow({ googlePosition: "00000000000000000009" }));

    const result = await syncGoogleTasksForUser("u-1");

    expect(result.pulledUpdated).toBe(1);
    expect(taskUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "t-1" },
        data: expect.objectContaining({
          googleParentId: "g-parent",
          googlePosition: "00000000000000000002",
        }),
      })
    );
  });

  it("clears stale parent + position when Google no longer sends them", async () => {
    // The task was promoted to top level in Google — the resource comes
    // back with no `parent`, and the row must shed the old one.
    mockedTasks.mockResolvedValue([
      { id: "g1", title: "Same", status: "needsAction", updated: "2026-07-18T00:00:00Z" },
    ]);
    taskFindFirst.mockResolvedValue(
      existingRow({
        googleParentId: "g-old-parent",
        googlePosition: "00000000000000000007",
      })
    );

    const result = await syncGoogleTasksForUser("u-1");

    expect(result.pulledUpdated).toBe(1);
    expect(taskUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "t-1" },
        data: expect.objectContaining({ googleParentId: null, googlePosition: null }),
      })
    );
  });

  it("refreshes position via the metadata patch when the OpsHub row is newer", async () => {
    // OpsHub content wins the last-write contest, but parent/position
    // are pull-only mirror fields — they refresh anyway, alone.
    mockedTasks.mockResolvedValue([
      {
        id: "g1",
        title: "Same",
        status: "needsAction",
        updated: "2026-06-01T00:00:00Z",
        position: "00000000000000000004",
      },
    ]);
    taskFindFirst.mockResolvedValue(
      existingRow({
        updatedAt: new Date("2026-07-10T00:00:00Z"),
        googlePosition: "00000000000000000001",
      })
    );

    await syncGoogleTasksForUser("u-1");

    expect(taskUpdate).toHaveBeenCalledWith({
      where: { id: "t-1" },
      data: { googlePosition: "00000000000000000004" },
    });
  });

  it("stamps parent + position from the patch response on the alias-pin path", async () => {
    mockedTasks.mockResolvedValue([]);
    taskFindMany.mockResolvedValue([
      existingRow({ id: "t-a", sourceId: "@default:g5", assigneeId: "u-1" }),
    ]);
    mockedPatch.mockResolvedValue({
      id: "g5",
      parent: "g-parent",
      position: "00000000000000000042",
    });

    const result = await syncGoogleTasksForUser("u-1");

    expect(result.pushed).toBe(1);
    expect(mockedPatch).toHaveBeenCalledWith("token", "list-default", "g5", expect.any(Object));
    expect(taskUpdate).toHaveBeenCalledWith({
      where: { id: "t-a" },
      data: {
        sourceId: "list-default:g5",
        googleListId: "list-default",
        googleParentId: "g-parent",
        googlePosition: "00000000000000000042",
      },
    });
  });
});

describe("pushNewTaskToGoogle destination", () => {
  beforeEach(() => {
    taskFindFirst.mockResolvedValue({
      id: "t-1",
      title: "Send to phone",
      description: null,
      dueDate: null,
      sourceType: null,
    });
    mockedInsert.mockResolvedValue({ id: "g-new", position: "00000000000000000099" });
  });

  it("inserts into a known mirror list and stamps sourceId + googleListId + position", async () => {
    listFindUnique.mockResolvedValue({ listId: "list-b" });

    const res = await pushNewTaskToGoogle("u-1", "t-1", "list-b");

    expect(res.error).toBeUndefined();
    expect(mockedInsert).toHaveBeenCalledWith("token", "list-b", expect.any(Object));
    expect(taskUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          sourceId: "list-b:g-new",
          googleListId: "list-b",
          // Google's assigned "My order" slot lands immediately — the
          // insert is top-level, so no parent.
          googleParentId: null,
          googlePosition: "00000000000000000099",
        }),
      })
    );
  });

  it("falls back to the default list when the target isn't in the mirror", async () => {
    listFindUnique.mockResolvedValue(null);

    await pushNewTaskToGoogle("u-1", "t-1", "list-foreign");

    expect(mockedInsert).toHaveBeenCalledWith("token", "list-default", expect.any(Object));
    expect(taskUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ sourceId: "list-default:g-new" }),
      })
    );
  });

  it("goes to the default list when no target is given", async () => {
    await pushNewTaskToGoogle("u-1", "t-1");

    expect(listFindUnique).not.toHaveBeenCalled();
    expect(mockedInsert).toHaveBeenCalledWith("token", "list-default", expect.any(Object));
  });
});
