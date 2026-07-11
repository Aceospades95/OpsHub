import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock @/lib/db so the module-level import (used by sampleRows /
// exportRows) doesn't instantiate a real PrismaClient. commit() gets
// the same mock through ctx.db.
vi.mock("@/lib/db", () => ({
  db: {
    user: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    activityLog: { create: vi.fn() },
  },
}));

// The importer fires onboarding triggers (dynamic import) after each
// CREATED user — mock the module so tests neither hit the real engine
// nor a real Prisma client.
vi.mock("@/lib/workflows/triggers", () => ({
  fireEntityCreateTriggers: vi.fn().mockResolvedValue({ instanceIds: [], errors: [] }),
}));

// bcryptjs at 12 rounds is ~300ms per hash — irrelevant to what these
// tests assert, so stub it.
vi.mock("bcryptjs", () => ({
  hash: vi.fn().mockResolvedValue("hashed-placeholder"),
}));

import { db } from "@/lib/db";
import { fireEntityCreateTriggers } from "@/lib/workflows/triggers";
import { usersImporter } from "./users";
import type { ImportContext, ImportMode } from "../types";

const userFindMany = db.user.findMany as ReturnType<typeof vi.fn>;
const userFindUnique = db.user.findUnique as ReturnType<typeof vi.fn>;
const userCreate = db.user.create as ReturnType<typeof vi.fn>;
const userUpdate = db.user.update as ReturnType<typeof vi.fn>;
const fireTriggers = fireEntityCreateTriggers as ReturnType<typeof vi.fn>;

function mkCtx(mode: ImportMode, isPreview = false): ImportContext {
  return {
    triggeredBy: "admin-1",
    mode,
    isPreview,
    db: db as unknown as ImportContext["db"],
  };
}

describe("users importer commit() — mode handling (regression: importer used to ignore ctx.mode and always upsert)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("create mode SKIPS an existing user instead of updating it", async () => {
    userFindMany.mockResolvedValue([{ id: "u-existing", email: "jane@example.com" }]);

    const result = await usersImporter.commit(
      [{ name: "Jane Doe", email: "jane@example.com", role: "MANAGER" }],
      mkCtx("create")
    );

    expect(result.imported).toBe(0);
    expect(result.updated).toBe(0);
    expect(result.skipped).toBe(1);
    expect(userUpdate).not.toHaveBeenCalled();
    expect(userCreate).not.toHaveBeenCalled();
    expect(result.rows[0].status).toBe("skipped");
    expect(result.rows[0].message).toContain("already exists");
  });

  it("update mode SKIPS a row with no existing match", async () => {
    userFindMany.mockResolvedValue([]);

    const result = await usersImporter.commit(
      [{ name: "New Person", email: "new@example.com" }],
      mkCtx("update")
    );

    expect(result.imported).toBe(0);
    expect(result.updated).toBe(0);
    expect(result.skipped).toBe(1);
    expect(userCreate).not.toHaveBeenCalled();
    expect(result.rows[0].message).toContain("no existing record");
  });

  it("upsert mode updates the existing user", async () => {
    userFindMany.mockResolvedValue([{ id: "u-existing", email: "jane@example.com" }]);
    userUpdate.mockResolvedValue({ id: "u-existing", name: "Jane Doe" });

    const result = await usersImporter.commit(
      [{ name: "Jane Doe", email: "jane@example.com" }],
      mkCtx("upsert")
    );

    expect(result.updated).toBe(1);
    expect(result.imported).toBe(0);
    expect(userUpdate).toHaveBeenCalledOnce();
    // Never touches auth-owned columns on update.
    const updateArg = userUpdate.mock.calls[0][0];
    expect(updateArg.data).not.toHaveProperty("hashedPassword");
    expect(updateArg.data).not.toHaveProperty("email");
  });

  it("fill-blanks mode only writes fields that are empty on the existing user", async () => {
    userFindMany.mockResolvedValue([{ id: "u-existing", email: "jane@example.com" }]);
    userFindUnique.mockResolvedValue({
      id: "u-existing",
      name: "Jane Original",
      email: "jane@example.com",
      role: "MANAGER",
      hasLoginAccess: true,
      isActive: true,
      avatar: null,
      department: "Ops",
      jobTitle: null,
      location: null,
      phone: null,
      terminationDate: null,
    });
    userUpdate.mockResolvedValue({ id: "u-existing", name: "Jane Original" });

    const result = await usersImporter.commit(
      [
        {
          name: "Jane CSV",
          email: "jane@example.com",
          department: "Field", // existing "Ops" — must NOT be overwritten
          jobTitle: "Foreman", // existing null — must be filled
          phone: "", // blank incoming — never written
        },
      ],
      mkCtx("fill-blanks")
    );

    expect(result.updated).toBe(1);
    const written = userUpdate.mock.calls[0][0].data;
    expect(written).toEqual({ jobTitle: "Foreman" });
  });

  it("creates a warning (not a silent drop) for an unresolvable managerEmail", async () => {
    userFindMany
      .mockResolvedValueOnce([]) // initial email index
      .mockResolvedValueOnce([]); // manager resolution pass
    userCreate.mockResolvedValue({ id: "u-new", name: "New Person" });

    const result = await usersImporter.commit(
      [
        {
          name: "New Person",
          email: "new@example.com",
          managerEmail: "ghost@example.com",
        },
      ],
      mkCtx("create")
    );

    expect(result.imported).toBe(1);
    expect(result.warnings).toBe(1);
    expect(result.rows[0].warnings?.join(" ")).toContain("Manager not found");
  });
});

describe("users importer — onboarding triggers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("fires ENTITY_CREATE triggers for each CREATED user", async () => {
    userFindMany.mockResolvedValue([]);
    userCreate.mockResolvedValue({ id: "u-new", name: "New Person" });

    await usersImporter.commit(
      [{ name: "New Person", email: "new@example.com" }],
      mkCtx("create")
    );

    expect(fireTriggers).toHaveBeenCalledTimes(1);
    expect(fireTriggers).toHaveBeenCalledWith({
      entityType: "User",
      entityId: "u-new",
      createdById: "admin-1",
    });
  });

  it("does NOT fire triggers on updates", async () => {
    userFindMany.mockResolvedValue([{ id: "u-existing", email: "jane@example.com" }]);
    userUpdate.mockResolvedValue({ id: "u-existing", name: "Jane" });

    await usersImporter.commit(
      [{ name: "Jane", email: "jane@example.com" }],
      mkCtx("upsert")
    );

    expect(fireTriggers).not.toHaveBeenCalled();
  });

  it("does NOT fire triggers on preview runs", async () => {
    userFindMany.mockResolvedValue([]);
    userCreate.mockResolvedValue({ id: "u-new", name: "New Person" });

    const result = await usersImporter.commit(
      [{ name: "New Person", email: "new@example.com" }],
      mkCtx("create", /* isPreview */ true)
    );

    expect(result.imported).toBe(1);
    expect(fireTriggers).not.toHaveBeenCalled();
  });
});
