/**
 * Tests for the contact interaction-log actions (CRM phase 2).
 *
 * The spec pins four behaviours:
 *
 *  - A user without clients canEdit (contacts ride the clients-module
 *    gate) gets "Permission denied" and the DB create is never called.
 *  - A kind outside the closed INTERACTION_KINDS set is rejected.
 *  - Delete is author-or-ADMIN only: a non-author editor is refused,
 *    the author (and an ADMIN) goes through — as a HARD delete.
 *  - Logging against a soft-deleted contact is rejected, with the
 *    deletedAt filter applied in the SQL where clause.
 *
 * Same mocked-db idiom as search.test.ts: `db`, `requireAuth`,
 * `resolveModulePerms`, `logActivity`, and next/cache are all mocked;
 * no real database is touched.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  db: {
    contact: { findFirst: vi.fn() },
    contactInteraction: {
      create: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
  },
}));
vi.mock("@/lib/permissions", () => ({
  requireAuth: vi.fn(),
  resolveModulePerms: vi.fn(),
}));
vi.mock("@/lib/activity", () => ({
  logActivity: vi.fn(async () => undefined),
}));
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

import { db } from "@/lib/db";
import { requireAuth, resolveModulePerms } from "@/lib/permissions";
import { logActivity } from "@/lib/activity";
import { logInteraction, updateInteraction, deleteInteraction } from "./interactions";

const dbMock = db as unknown as {
  contact: { findFirst: ReturnType<typeof vi.fn> };
  contactInteraction: {
    create: ReturnType<typeof vi.fn>;
    findUnique: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
  };
};
const requireAuthMock = requireAuth as unknown as ReturnType<typeof vi.fn>;
const resolveModulePermsMock = resolveModulePerms as unknown as ReturnType<typeof vi.fn>;
const logActivityMock = logActivity as unknown as ReturnType<typeof vi.fn>;

const NO_PERMS = {
  canView: false,
  canEdit: false,
  canCreate: false,
  canDelete: false,
  canComment: false,
  canUpload: false,
  canManage: false,
};

/** Clients-module editor: canView + canEdit, nothing broader. */
const EDIT_PERMS = { ...NO_PERMS, canView: true, canEdit: true };

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
  // Default: an editor, an existing live contact, writes succeed.
  requireAuthMock.mockResolvedValue({ id: "u1", role: "CONTRIBUTOR" });
  resolveModulePermsMock.mockResolvedValue(EDIT_PERMS);
  dbMock.contact.findFirst.mockResolvedValue({ id: "c1", name: "Ann Chovey" });
  dbMock.contactInteraction.create.mockResolvedValue({ id: "i1" });
  dbMock.contactInteraction.findUnique.mockResolvedValue(null);
  dbMock.contactInteraction.update.mockResolvedValue({ id: "i1" });
  dbMock.contactInteraction.delete.mockResolvedValue({ id: "i1" });
});

describe("logInteraction", () => {
  it("VIEWER without clients canEdit gets Permission denied — DB create never called", async () => {
    requireAuthMock.mockResolvedValue({ id: "viewer", role: "VIEWER" });
    resolveModulePermsMock.mockResolvedValue({ ...NO_PERMS, canView: true });

    const result = await logInteraction({
      contactId: "c1",
      kind: "CALL",
      summary: "Called about the tender",
    });

    expect(result.error).toBe("Permission denied");
    expect(dbMock.contactInteraction.create).not.toHaveBeenCalled();
  });

  it("rejects a kind outside the closed set", async () => {
    const result = await logInteraction({
      contactId: "c1",
      kind: "FAX",
      summary: "Faxed the quote",
    });

    expect(result.error).toBe("Unknown interaction kind");
    expect(dbMock.contactInteraction.create).not.toHaveBeenCalled();
  });

  it("rejects logging against a soft-deleted contact — filter lives in the SQL where clause", async () => {
    // The action queries with deletedAt: null, so a soft-deleted
    // contact simply doesn't come back.
    dbMock.contact.findFirst.mockResolvedValue(null);

    const result = await logInteraction({
      contactId: "gone",
      kind: "NOTE",
      summary: "Note on a deleted contact",
    });

    expect(result.error).toBe("Not found");
    expect(dbMock.contactInteraction.create).not.toHaveBeenCalled();
    const call = dbMock.contact.findFirst.mock.calls[0][0];
    expect(call.where.deletedAt).toBeNull();
  });

  it("rejects a blank summary with a field error", async () => {
    const result = await logInteraction({ contactId: "c1", kind: "CALL", summary: "   " });

    expect(result.error).toBe("Invalid input");
    expect(result.fieldErrors?.summary?.[0]).toBe("Summary is required");
    expect(dbMock.contactInteraction.create).not.toHaveBeenCalled();
  });

  it("rejects a summary over the 200-char cap", async () => {
    const result = await logInteraction({
      contactId: "c1",
      kind: "CALL",
      summary: "x".repeat(201),
    });

    expect(result.error).toBe("Invalid input");
    expect(result.fieldErrors?.summary?.[0]).toContain("at most 200");
    expect(dbMock.contactInteraction.create).not.toHaveBeenCalled();
  });

  it("rejects an unparseable occurredAt instead of silently logging it as now", async () => {
    const result = await logInteraction({
      contactId: "c1",
      kind: "CALL",
      occurredAt: "not-a-date",
      summary: "Quick sync",
    });

    expect(result.error).toBe("Invalid input");
    expect(result.fieldErrors?.occurredAt?.[0]).toBe("Enter a valid date");
    expect(dbMock.contactInteraction.create).not.toHaveBeenCalled();
  });

  it("logs a call: trims the summary, parses the calendar date to UTC midnight, stamps the author, writes activity", async () => {
    const result = await logInteraction({
      contactId: "c1",
      kind: "CALL",
      occurredAt: "2026-08-01",
      summary: "  Intro call  ",
      notes: "Talked pricing.",
    });

    expect(result.success).toBe(true);
    expect(result.interactionId).toBe("i1");
    expect(dbMock.contactInteraction.create).toHaveBeenCalledTimes(1);
    const { data } = dbMock.contactInteraction.create.mock.calls[0][0];
    expect(data.contactId).toBe("c1");
    expect(data.kind).toBe("CALL");
    expect(data.summary).toBe("Intro call");
    expect(data.notes).toBe("Talked pricing.");
    expect(data.createdById).toBe("u1");
    expect(data.occurredAt).toEqual(new Date("2026-08-01T00:00:00.000Z"));
    expect(logActivityMock).toHaveBeenCalledWith(
      "logged-interaction",
      "contact",
      "c1",
      "u1",
      "Call: Intro call"
    );
  });
});

describe("updateInteraction authz", () => {
  it("a non-author non-admin editor is refused, even with full module perms", async () => {
    requireAuthMock.mockResolvedValue({ id: "mallory", role: "MANAGER" });
    resolveModulePermsMock.mockResolvedValue(ALL_PERMS);
    dbMock.contactInteraction.findUnique.mockResolvedValue({
      id: "i1",
      contactId: "c1",
      createdById: "author",
      contact: { deletedAt: null },
    });

    const result = await updateInteraction("i1", { kind: "CALL", summary: "Rewritten" });

    expect(result.error).toBe("Permission denied");
    expect(dbMock.contactInteraction.update).not.toHaveBeenCalled();
  });

  it("the author may edit their own entry", async () => {
    requireAuthMock.mockResolvedValue({ id: "author", role: "CONTRIBUTOR" });
    dbMock.contactInteraction.findUnique.mockResolvedValue({
      id: "i1",
      contactId: "c1",
      createdById: "author",
      contact: { deletedAt: null },
    });

    const result = await updateInteraction("i1", {
      kind: "MEETING",
      occurredAt: "2026-08-02",
      summary: "Site walkthrough",
    });

    expect(result.success).toBe(true);
    expect(dbMock.contactInteraction.update).toHaveBeenCalledTimes(1);
    const { data } = dbMock.contactInteraction.update.mock.calls[0][0];
    expect(data.kind).toBe("MEETING");
    expect(data.summary).toBe("Site walkthrough");
  });
});

describe("deleteInteraction authz", () => {
  const ROW = {
    id: "i1",
    contactId: "c1",
    createdById: "author",
    kind: "CALL",
    summary: "Intro call",
  };

  it("a non-author non-admin editor is refused, even with full module perms", async () => {
    requireAuthMock.mockResolvedValue({ id: "mallory", role: "MANAGER" });
    resolveModulePermsMock.mockResolvedValue(ALL_PERMS);
    dbMock.contactInteraction.findUnique.mockResolvedValue(ROW);

    const result = await deleteInteraction("i1");

    expect(result.error).toBe("Permission denied");
    expect(dbMock.contactInteraction.delete).not.toHaveBeenCalled();
  });

  it("the author may delete their own entry (hard delete)", async () => {
    requireAuthMock.mockResolvedValue({ id: "author", role: "CONTRIBUTOR" });
    dbMock.contactInteraction.findUnique.mockResolvedValue(ROW);

    const result = await deleteInteraction("i1");

    expect(result.success).toBe(true);
    expect(dbMock.contactInteraction.delete).toHaveBeenCalledWith({ where: { id: "i1" } });
    expect(logActivityMock).toHaveBeenCalledWith(
      "deleted-interaction",
      "contact",
      "c1",
      "author",
      "Call: Intro call"
    );
  });

  it("an ADMIN may delete someone else's entry", async () => {
    requireAuthMock.mockResolvedValue({ id: "admin", role: "ADMIN" });
    resolveModulePermsMock.mockResolvedValue(ALL_PERMS);
    dbMock.contactInteraction.findUnique.mockResolvedValue(ROW);

    const result = await deleteInteraction("i1");

    expect(result.success).toBe(true);
    expect(dbMock.contactInteraction.delete).toHaveBeenCalledWith({ where: { id: "i1" } });
  });
});
