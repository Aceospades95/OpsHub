/**
 * Project merge — repoint every child of a duplicate project onto the
 * keeper, fill the keeper's blank fields from the source, then
 * soft-delete the source (recoverable from the bin, though its
 * children stay with the keeper on restore — the merge is the point).
 *
 * Exists because imports created exact-twin projects (52 rows, 30
 * distinct names) and hand-deleting 22 duplicates row by row is
 * miserable. Modeled on lib/merge-users-fk.ts: a declared reassignment
 * walk inside one transaction, with join-tables deduped against their
 * unique constraints (keeper already linked → source row dropped).
 */

import type { PrismaClient } from "@prisma/client";
import { normalizeImportName } from "@/lib/importers/importers/clients";

/** Plain FK columns that can be bulk-updated without unique conflicts. */
const SIMPLE_REASSIGNMENTS: { model: string; column: string }[] = [
  { model: "contract", column: "projectId" },
  { model: "document", column: "projectId" },
  { model: "file", column: "projectId" },
  { model: "comment", column: "projectId" },
  { model: "milestone", column: "projectId" },
  { model: "externalLink", column: "projectId" },
  { model: "embed", column: "projectId" },
  { model: "task", column: "projectId" },
  { model: "sandboxPage", column: "projectId" },
  { model: "bidOpportunity", column: "projectId" },
  { model: "assignment", column: "projectId" },
  { model: "projectRole", column: "projectId" },
  { model: "quote", column: "projectId" },
  { model: "activityLog", column: "projectId" },
  { model: "project", column: "parentProjectId" },
];

/** Join tables where (other, projectId) is unique — dedupe then move. */
const JOIN_REASSIGNMENTS: { model: string; otherColumn: string }[] = [
  { model: "projectMember", otherColumn: "userId" },
  { model: "projectTool", otherColumn: "toolId" },
  { model: "supplierProject", otherColumn: "supplierId" },
  { model: "subcontractorProject", otherColumn: "subcontractorId" },
  { model: "partnershipProject", otherColumn: "partnershipId" },
];

export interface ProjectMergeCounts {
  moved: Record<string, number>;
  droppedDuplicateLinks: number;
}

/**
 * Execute the merge inside a transaction. Throws on failure; the
 * caller translates to an action error. `fromId` must already be
 * validated as a different, same-client, non-deleted project.
 */
export async function executeProjectMerge(
  db: PrismaClient,
  fromId: string,
  toId: string
): Promise<ProjectMergeCounts> {
  return db.$transaction(async (tx) => {
    const counts: ProjectMergeCounts = { moved: {}, droppedDuplicateLinks: 0 };

    for (const { model, column } of SIMPLE_REASSIGNMENTS) {
      const delegate = (tx as Record<string, unknown>)[model] as {
        updateMany: (args: {
          where: Record<string, unknown>;
          data: Record<string, unknown>;
        }) => Promise<{ count: number }>;
      };
      const res = await delegate.updateMany({
        where: { [column]: fromId },
        data: { [column]: toId },
      });
      if (res.count > 0) counts.moved[model] = res.count;
    }

    for (const { model, otherColumn } of JOIN_REASSIGNMENTS) {
      const delegate = (tx as Record<string, unknown>)[model] as {
        findMany: (args: Record<string, unknown>) => Promise<Record<string, unknown>[]>;
        deleteMany: (args: Record<string, unknown>) => Promise<{ count: number }>;
        updateMany: (args: Record<string, unknown>) => Promise<{ count: number }>;
      };
      const sourceRows = await delegate.findMany({
        where: { projectId: fromId },
        select: { id: true, [otherColumn]: true },
      });
      if (sourceRows.length === 0) continue;
      const keeperRows = await delegate.findMany({
        where: { projectId: toId },
        select: { [otherColumn]: true },
      });
      const keeperHas = new Set(keeperRows.map((r) => String(r[otherColumn])));
      const dupIds = sourceRows
        .filter((r) => keeperHas.has(String(r[otherColumn])))
        .map((r) => String(r.id));
      if (dupIds.length > 0) {
        const dropped = await delegate.deleteMany({ where: { id: { in: dupIds } } });
        counts.droppedDuplicateLinks += dropped.count;
      }
      const res = await delegate.updateMany({
        where: { projectId: fromId },
        data: { projectId: toId },
      });
      if (res.count > 0) counts.moved[model] = res.count;
    }

    // Related-project links are directional pairs unique on
    // (projectId, relatedProjectId). Two hazards the bulk update can't
    // handle: a from↔to link would become a self-reference after the
    // move (drop it), and either direction can collide with a link the
    // keeper already has (drop the source's copy). Row-by-row is fine —
    // relation counts are tiny.
    const forwardRelations = await tx.projectRelation.findMany({
      where: { projectId: fromId },
      select: { id: true, relatedProjectId: true },
    });
    for (const row of forwardRelations) {
      if (row.relatedProjectId === toId) {
        await tx.projectRelation.delete({ where: { id: row.id } });
        counts.droppedDuplicateLinks++;
        continue;
      }
      const clash = await tx.projectRelation.findUnique({
        where: {
          projectId_relatedProjectId: {
            projectId: toId,
            relatedProjectId: row.relatedProjectId,
          },
        },
        select: { id: true },
      });
      if (clash) {
        await tx.projectRelation.delete({ where: { id: row.id } });
        counts.droppedDuplicateLinks++;
      } else {
        await tx.projectRelation.update({
          where: { id: row.id },
          data: { projectId: toId },
        });
        counts.moved.projectRelation = (counts.moved.projectRelation ?? 0) + 1;
      }
    }
    const reverseRelations = await tx.projectRelation.findMany({
      where: { relatedProjectId: fromId },
      select: { id: true, projectId: true },
    });
    for (const row of reverseRelations) {
      if (row.projectId === toId) {
        await tx.projectRelation.delete({ where: { id: row.id } });
        counts.droppedDuplicateLinks++;
        continue;
      }
      const clash = await tx.projectRelation.findUnique({
        where: {
          projectId_relatedProjectId: {
            projectId: row.projectId,
            relatedProjectId: toId,
          },
        },
        select: { id: true },
      });
      if (clash) {
        await tx.projectRelation.delete({ where: { id: row.id } });
        counts.droppedDuplicateLinks++;
      } else {
        await tx.projectRelation.update({
          where: { id: row.id },
          data: { relatedProjectId: toId },
        });
        counts.moved.projectRelation = (counts.moved.projectRelation ?? 0) + 1;
      }
    }

    // Polymorphic contact links: same dedupe against the unique triple.
    const sourceLinks = await tx.contactLink.findMany({
      where: { entityType: "project", entityId: fromId },
      select: { id: true, contactId: true },
    });
    if (sourceLinks.length > 0) {
      const keeperLinks = await tx.contactLink.findMany({
        where: { entityType: "project", entityId: toId },
        select: { contactId: true },
      });
      const keeperHas = new Set(keeperLinks.map((l) => l.contactId));
      const dupIds = sourceLinks
        .filter((l) => keeperHas.has(l.contactId))
        .map((l) => l.id);
      if (dupIds.length > 0) {
        const dropped = await tx.contactLink.deleteMany({ where: { id: { in: dupIds } } });
        counts.droppedDuplicateLinks += dropped.count;
      }
      const res = await tx.contactLink.updateMany({
        where: { entityType: "project", entityId: fromId },
        data: { entityId: toId },
      });
      if (res.count > 0) counts.moved.contactLink = res.count;
    }

    // Fill the keeper's blank fields from the source, then soft-delete
    // the source. Twins from the importer usually have identical data,
    // so this mostly no-ops — it matters when only the dupe carried a
    // date or description.
    const [from, to] = await Promise.all([
      tx.project.findUniqueOrThrow({ where: { id: fromId } }),
      tx.project.findUniqueOrThrow({ where: { id: toId } }),
    ]);
    const fill: Record<string, unknown> = {};
    for (const f of [
      "description",
      "notes",
      "sourceNotes",
      "openQuestions",
      "startDate",
      "endDate",
      "serviceOfferingId",
      "ownerId",
    ] as const) {
      const keeperVal = to[f];
      const sourceVal = from[f];
      const keeperBlank =
        keeperVal === null || keeperVal === undefined || keeperVal === "";
      if (keeperBlank && sourceVal !== null && sourceVal !== undefined && sourceVal !== "") {
        fill[f] = sourceVal;
      }
    }
    if (Object.keys(fill).length > 0) {
      await tx.project.update({ where: { id: toId }, data: fill });
    }
    await tx.project.update({
      where: { id: fromId },
      data: { deletedAt: new Date() },
    });

    return counts;
  });
}

/**
 * Duplicate-detection normalization. Delegates to the importers'
 * normalizeImportName so the create/edit guard, the importer guardrail,
 * the possible-duplicates report, and the merge dialog's
 * "likely duplicate" flag all agree on what counts as the same name.
 * Returns "" for names that are all whitespace/punctuation — callers
 * must skip normalized matching in that case.
 */
export function normalizeProjectName(name: string): string {
  return normalizeImportName(name);
}
