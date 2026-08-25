/**
 * Unit tests for the project-merge FK walk (lib/merge-projects.ts).
 *
 * executeProjectMerge takes the client as an argument, so no vi.mock is
 * needed — a hand-built fake transaction records every delegate call
 * and the assertions pin the rules that make the merge safe:
 *
 *   - every simple projectId column is bulk-repointed
 *   - join tables dedupe against the keeper BEFORE moving
 *   - related-project links drop self-references and unique clashes
 *   - keeper fill-blanks never overwrite a non-blank keeper value
 *   - the source ends soft-deleted, never hard-deleted
 *
 * The end-to-end behavior against real Postgres is covered by the live
 * verification drive (.claude/skills/verify).
 */

import { describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { executeProjectMerge, normalizeProjectName } from "./merge-projects";
import { normalizeImportName } from "@/lib/importers/importers/clients";

const FROM = "proj_dupe";
const TO = "proj_keeper";

interface Call {
  model: string;
  method: string;
  args: unknown;
}

/**
 * Fake transaction: every model delegate records calls and answers from
 * per-test fixtures. Defaults: updateMany/deleteMany → count 0/None,
 * findMany → [], findUnique → null.
 */
function makeFakeTx(fixtures: {
  findMany?: Record<string, Record<string, unknown>[][]>;
  findUnique?: Record<string, (Record<string, unknown> | null)[]>;
  projects?: Record<string, Record<string, unknown>>;
} = {}) {
  const calls: Call[] = [];
  const findManyQueues = new Map(
    Object.entries(fixtures.findMany ?? {}).map(([k, v]) => [k, [...v]])
  );
  const findUniqueQueues = new Map(
    Object.entries(fixtures.findUnique ?? {}).map(([k, v]) => [k, [...v]])
  );

  const tx = new Proxy(
    {},
    {
      get(_target, modelName: string) {
        if (modelName === "$transaction") {
          return async (fn: (t: unknown) => Promise<unknown>) => fn(tx);
        }
        return new Proxy(
          {},
          {
            get(_t, method: string) {
              return async (args: unknown) => {
                calls.push({ model: modelName, method, args });
                if (method === "findMany") {
                  return findManyQueues.get(modelName)?.shift() ?? [];
                }
                if (method === "findUnique") {
                  return findUniqueQueues.get(modelName)?.shift() ?? null;
                }
                if (method === "findUniqueOrThrow") {
                  const where = (args as { where: { id: string } }).where;
                  const row = fixtures.projects?.[where.id];
                  if (!row) throw new Error(`no project fixture for ${where.id}`);
                  return row;
                }
                if (method === "updateMany" || method === "deleteMany") {
                  // Count is derived from the where clause where it
                  // matters (join moves); tests only assert call shape.
                  return { count: 1 };
                }
                return {};
              };
            },
          }
        );
      },
    }
  ) as unknown as PrismaClient;

  return { tx, calls };
}

/** Blank keeper/source project rows for the fill-blanks stage. */
function projectRow(overrides: Record<string, unknown> = {}) {
  return {
    description: null,
    notes: null,
    sourceNotes: null,
    openQuestions: null,
    startDate: null,
    endDate: null,
    serviceOfferingId: null,
    ownerId: null,
    ...overrides,
  };
}

function callsFor(calls: Call[], model: string, method?: string) {
  return calls.filter(
    (c) => c.model === model && (method === undefined || c.method === method)
  );
}

describe("executeProjectMerge", () => {
  it("bulk-repoints every simple projectId column from source to keeper", async () => {
    const { tx, calls } = makeFakeTx({
      projects: { [FROM]: projectRow(), [TO]: projectRow() },
    });
    await executeProjectMerge(tx, FROM, TO);

    for (const model of [
      "contract",
      "document",
      "file",
      "comment",
      "milestone",
      "externalLink",
      "embed",
      "task",
      "sandboxPage",
      "bidOpportunity",
      "assignment",
      "projectRole",
      "quote",
      "activityLog",
    ]) {
      const updates = callsFor(calls, model, "updateMany");
      expect(updates, model).toHaveLength(1);
      expect(updates[0].args).toEqual({
        where: { projectId: FROM },
        data: { projectId: TO },
      });
    }
    // The self-referencing hierarchy column moves children of the dupe
    // under the keeper.
    const parentMoves = callsFor(calls, "project", "updateMany");
    expect(parentMoves).toHaveLength(1);
    expect(parentMoves[0].args).toEqual({
      where: { parentProjectId: FROM },
      data: { parentProjectId: TO },
    });
  });

  it("dedupes join-table rows against the keeper before moving", async () => {
    const { tx, calls } = makeFakeTx({
      findMany: {
        supplierProject: [
          // 1st call: source rows; 2nd call: keeper rows.
          [
            { id: "sp1", supplierId: "sup_a" },
            { id: "sp2", supplierId: "sup_b" },
          ],
          [{ supplierId: "sup_a" }],
        ],
      },
      projects: { [FROM]: projectRow(), [TO]: projectRow() },
    });
    const counts = await executeProjectMerge(tx, FROM, TO);

    const deletes = callsFor(calls, "supplierProject", "deleteMany");
    expect(deletes).toHaveLength(1);
    // Only the row whose supplier the keeper already has is dropped —
    // sup_b's row survives to be moved.
    expect(deletes[0].args).toEqual({ where: { id: { in: ["sp1"] } } });
    const moves = callsFor(calls, "supplierProject", "updateMany");
    expect(moves).toHaveLength(1);
    expect(moves[0].args).toEqual({
      where: { projectId: FROM },
      data: { projectId: TO },
    });
    expect(counts.droppedDuplicateLinks).toBeGreaterThanOrEqual(1);
  });

  it("moves nothing for join tables when the source has no rows", async () => {
    const { tx, calls } = makeFakeTx({
      projects: { [FROM]: projectRow(), [TO]: projectRow() },
    });
    await executeProjectMerge(tx, FROM, TO);
    // findMany(source) returned [] → no keeper lookup, no delete, no move.
    expect(callsFor(calls, "projectMember", "findMany")).toHaveLength(1);
    expect(callsFor(calls, "projectMember", "deleteMany")).toHaveLength(0);
    expect(callsFor(calls, "projectMember", "updateMany")).toHaveLength(0);
  });

  it("drops self-referencing and clashing related-project links, moves the rest", async () => {
    const { tx, calls } = makeFakeTx({
      findMany: {
        projectRelation: [
          // Forward rows (projectId = FROM): one link at the keeper
          // itself (self-ref after move), one that clashes with an
          // existing keeper link, one clean.
          [
            { id: "rel_self", relatedProjectId: TO },
            { id: "rel_clash", relatedProjectId: "proj_x" },
            { id: "rel_clean", relatedProjectId: "proj_y" },
          ],
          // Reverse rows (relatedProjectId = FROM): one clean.
          [{ id: "rel_rev", projectId: "proj_z" }],
        ],
      },
      findUnique: {
        // Answers for the two forward clash checks (proj_x exists on
        // the keeper, proj_y doesn't), then the reverse check.
        projectRelation: [{ id: "keeper_has_x" }, null, null],
      },
      projects: { [FROM]: projectRow(), [TO]: projectRow() },
    });
    const counts = await executeProjectMerge(tx, FROM, TO);

    const deletes = callsFor(calls, "projectRelation", "delete");
    expect(deletes.map((d) => (d.args as { where: { id: string } }).where.id)).toEqual([
      "rel_self",
      "rel_clash",
    ]);
    const updates = callsFor(calls, "projectRelation", "update");
    expect(updates).toHaveLength(2);
    expect(updates[0].args).toEqual({
      where: { id: "rel_clean" },
      data: { projectId: TO },
    });
    expect(updates[1].args).toEqual({
      where: { id: "rel_rev" },
      data: { relatedProjectId: TO },
    });
    expect(counts.moved.projectRelation).toBe(2);
    expect(counts.droppedDuplicateLinks).toBe(2);
  });

  it("dedupes polymorphic contact links on the unique triple", async () => {
    const { tx, calls } = makeFakeTx({
      findMany: {
        contactLink: [
          [
            { id: "cl1", contactId: "ct_a" },
            { id: "cl2", contactId: "ct_b" },
          ],
          [{ contactId: "ct_a" }],
        ],
      },
      projects: { [FROM]: projectRow(), [TO]: projectRow() },
    });
    await executeProjectMerge(tx, FROM, TO);

    const deletes = callsFor(calls, "contactLink", "deleteMany");
    expect(deletes).toHaveLength(1);
    expect(deletes[0].args).toEqual({ where: { id: { in: ["cl1"] } } });
    const moves = callsFor(calls, "contactLink", "updateMany");
    expect(moves[0].args).toEqual({
      where: { entityType: "project", entityId: FROM },
      data: { entityId: TO },
    });
  });

  it("fills only the keeper's blank fields from the source", async () => {
    const { tx, calls } = makeFakeTx({
      projects: {
        [FROM]: projectRow({
          description: "from the dupe",
          startDate: new Date("2026-01-01"),
          ownerId: "user_dupe",
        }),
        [TO]: projectRow({
          // Keeper already has an owner — must NOT be overwritten.
          ownerId: "user_keeper",
        }),
      },
    });
    await executeProjectMerge(tx, FROM, TO);

    const updates = callsFor(calls, "project", "update");
    // First update = fill-blanks on keeper, second = soft-delete source.
    expect(updates).toHaveLength(2);
    expect(updates[0].args).toEqual({
      where: { id: TO },
      data: {
        description: "from the dupe",
        startDate: new Date("2026-01-01"),
      },
    });
    const softDelete = updates[1].args as {
      where: { id: string };
      data: { deletedAt: unknown };
    };
    expect(softDelete.where.id).toBe(FROM);
    expect(softDelete.data.deletedAt).toBeInstanceOf(Date);
  });

  it("skips the fill update entirely when the keeper has no blanks to fill", async () => {
    const { tx, calls } = makeFakeTx({
      projects: {
        [FROM]: projectRow({ description: "dupe text" }),
        [TO]: projectRow({ description: "keeper text" }),
      },
    });
    await executeProjectMerge(tx, FROM, TO);
    const updates = callsFor(calls, "project", "update");
    // Only the soft-delete — no fill-blanks write.
    expect(updates).toHaveLength(1);
    expect((updates[0].args as { where: { id: string } }).where.id).toBe(FROM);
  });
});

describe("normalizeProjectName", () => {
  it("agrees with the importers' guardrail normalization", () => {
    for (const name of [
      "Acme Rollout.",
      "  acme   ROLLOUT ",
      "Acme Rollout —",
      "Network refresh / ",
      "...",
      "",
    ]) {
      expect(normalizeProjectName(name)).toBe(normalizeImportName(name));
    }
  });

  it("treats punctuation/spacing twins as the same project", () => {
    expect(normalizeProjectName("Acme Rollout.")).toBe(
      normalizeProjectName("acme  rollout")
    );
    // All-punctuation names normalize to "" — callers skip matching.
    expect(normalizeProjectName(" .-— ")).toBe("");
  });
});
