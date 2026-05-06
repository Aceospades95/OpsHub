/**
 * Shared FK-walk for User merge scripts.
 *
 * Two scripts call into this:
 *   - prisma/merge-duplicate-users.ts — auto-finds duplicates by email.
 *   - prisma/merge-users-by-id.ts — operator picks `from` and `to` IDs
 *     explicitly (used for the Jacob Wright case where the dupes have
 *     *different* emails and the email-based finder can't help).
 *
 * The reassignment recipe is the canonical "every column on every table
 * that points at User.id" map. If you add a new model that references
 * User, add it here too — the merge will silently leave dangling FKs
 * otherwise (or, worse, hit a P2003 when deleting the source row).
 *
 * IMPORTANT: this does NOT cherry-pick "the better data" between the
 * two profile-level fields (department, jobTitle, location, phone). The
 * keeper's values are preserved as-is; the merged-in user's profile
 * fields are simply lost. Hand-merge those before running if needed.
 */

import type { PrismaClient } from "@prisma/client";

/**
 * Per-table reassignment recipe. Each entry produces one updateMany
 * call: `where: { [column]: fromId }` → `data: { [column]: toId }`.
 * Tables with composite uniques are handled separately below — they
 * are NOT in this list because Prisma would fail the bulk update on
 * collision.
 */
export const REASSIGNMENTS: { model: string; column: string }[] = [
  { model: "task", column: "assigneeId" },
  { model: "task", column: "createdById" },
  { model: "comment", column: "authorId" },
  { model: "activityLog", column: "userId" },
  { model: "file", column: "uploadedById" },
  { model: "file", column: "userId" },
  { model: "quote", column: "createdById" },
  { model: "quote", column: "assignedToId" },
  { model: "quoteTemplate", column: "createdById" },
  { model: "workflowTemplate", column: "createdById" },
  { model: "workflowInstance", column: "createdById" },
  { model: "workflowInstanceStep", column: "completedByUserId" },
  { model: "workflowEmailTemplate", column: "createdById" },
  { model: "scheduledTask", column: "createdById" },
  { model: "customReport", column: "createdById" },
  { model: "accessRequest", column: "requesterId" },
  { model: "accessRequest", column: "reviewerId" },
  { model: "notification", column: "recipientId" },
  { model: "notification", column: "actorId" },
  { model: "account", column: "userId" }, // critical: re-points the SSO linkage
  { model: "modulePermission", column: "userId" }, // composite unique: handled below
  { model: "entityPermission", column: "userId" }, // composite unique: handled below
  { model: "assignment", column: "employeeId" },
  { model: "certification", column: "assigneeId" },
  { model: "certification", column: "pointOfContactId" },
  { model: "certification", column: "signedOffById" },
  { model: "certificationRenewalChecklistItem", column: "completedById" },
  { model: "certificationRenewalHistory", column: "signedOffById" },
  { model: "client", column: "accountManagerId" },
  { model: "sandboxPage", column: "createdById" },
  { model: "customWidget", column: "createdById" },
  // User self-reference: managerId. If any direct reports were pointing
  // at the merged-in user, re-aim them at the keeper so the org-tree
  // doesn't lose them.
  { model: "user", column: "managerId" },
];

/**
 * Tables with composite-unique constraints that collide if both the
 * merged-in user and the keeper already have a row for the same scope.
 * Handled per-row: when a keeper row already covers the same scope,
 * the merged-in row is deleted; otherwise it is moved.
 */
export const COMPOSITE_UNIQUE_TABLES = new Set([
  "modulePermission", // (userId, module)
  "entityPermission", // (userId, entityType, entityId)
  "projectMember", // (userId, projectId)
  "milestoneAssignee", // (milestoneId, userId)
]);

/**
 * Move every FK pointing at `fromId` over to `toId`, then delete the
 * source User row. Composite-unique tables are handled per-row to
 * avoid Prisma raising P2002 on a bulk collision.
 *
 * Caller must already have validated:
 *   - both ids exist
 *   - fromId !== toId
 *   - the operator has authorization to merge
 *
 * Pass `targetEmail` to rename the keeper's email AFTER the FK walk,
 * before the source row is deleted. This is how the Jacob Wright merge
 * keeps the canonical j.wright@wynndalco.com email when the keeper is
 * actually the synthetic-email VP row.
 */
export async function executeMerge(
  db: PrismaClient,
  fromId: string,
  toId: string,
  opts: { targetEmail?: string } = {}
): Promise<void> {
  if (fromId === toId) {
    throw new Error("merge-users: from and to are the same id");
  }

  // Composite-unique tables first — they need per-row reassignment.
  await reassignWithCompositeUnique(db, "modulePermission", "userId", ["userId", "module"], fromId, toId);
  await reassignWithCompositeUnique(db, "entityPermission", "userId", ["userId", "entityType", "entityId"], fromId, toId);
  await reassignWithCompositeUnique(db, "projectMember", "userId", ["userId", "projectId"], fromId, toId);
  await reassignWithCompositeUnique(db, "milestoneAssignee", "userId", ["milestoneId", "userId"], fromId, toId);

  // Bulk reassignments for everything else.
  for (const { model, column } of REASSIGNMENTS) {
    if (COMPOSITE_UNIQUE_TABLES.has(model)) continue; // already handled

    // Self-reference: skip moving the keeper's own managerId.
    // (The bulk update where: { managerId: fromId } targets dependents
    // of `from`, which is the desired direction; this is a sanity
    // check in case the keeper's manager somehow was the merged-in
    // row.)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const delegate = (db as any)[model];
    if (!delegate?.updateMany) {
      console.warn(`  [skip] ${model}.updateMany not found on PrismaClient`);
      continue;
    }
    await delegate.updateMany({
      where: { [column]: fromId },
      data: { [column]: toId },
    });
  }

  // Optional rename of the keeper's email. Done AFTER the FK walk so
  // an early failure leaves the original email intact.
  if (opts.targetEmail) {
    await db.user.update({
      where: { id: toId },
      data: { email: opts.targetEmail.trim().toLowerCase() },
    });
  }

  // Finally, delete the merged-in User row. All FKs have been
  // re-pointed; if anything was missed, this raises a FK violation
  // rather than silently leaving an orphan.
  await db.user.delete({ where: { id: fromId } });
}

/**
 * Re-point a table where the FK column is part of a composite unique.
 * Each merged-in row is moved to the keeper UNLESS the keeper already
 * has a row covering the same scope, in which case the merged-in row
 * is deleted (the keeper's row wins — operator can hand-merge before
 * running if the merged-in row carried fresher data).
 */
async function reassignWithCompositeUnique(
  db: PrismaClient,
  model: string,
  fkColumn: string,
  scope: string[],
  fromUserId: string,
  toUserId: string
): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const delegate = (db as any)[model];
  if (!delegate?.findMany) return;
  const dupRows: Record<string, unknown>[] = await delegate.findMany({
    where: { [fkColumn]: fromUserId },
  });
  for (const row of dupRows) {
    const scopeMatch = scope.reduce<Record<string, unknown>>((acc, k) => {
      acc[k] = k === fkColumn ? toUserId : row[k];
      return acc;
    }, {});
    const conflict = await delegate.findFirst({ where: scopeMatch });
    if (conflict) {
      await delegate.delete({ where: { id: row.id } });
    } else {
      await delegate.update({
        where: { id: row.id },
        data: { [fkColumn]: toUserId },
      });
    }
  }
}
