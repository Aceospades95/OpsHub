/**
 * One-off cleanup: consolidate duplicate User rows produced before the
 * Google SSO auto-link landed.
 *
 * Background
 * ──────────
 * Before src/lib/auth-google-signin.ts shipped, a Google sign-in for a
 * pre-provisioned email could create a brand-new User row instead of
 * linking to the existing one. The pre-provisioned account (with the
 * intended role + permissions) was orphaned; the SSO user signed in as
 * a freshly-provisioned GUEST. This script walks every email that
 * appears on more than one User row and consolidates them.
 *
 * Strategy
 * ────────
 * For each duplicate set, the EARLIER `createdAt` row is the keeper —
 * that's the pre-provisioned account that was meant to receive the
 * permissions. Every FK that pointed at any of the other duplicates is
 * re-pointed at the keeper (Tasks, Comments, ActivityLog, Files,
 * Quotes, WorkflowInstances, Accounts, ProjectMembers, etc. — see
 * REASSIGNMENTS for the full list). Once every reference moves, the
 * duplicate User rows are deleted.
 *
 * IMPORTANT: this does NOT pick "the better data" between the two
 * profile-level fields (department, jobTitle, location, phone). The
 * keeper's values are preserved as-is; the duplicate's profile fields
 * are simply lost when its row is deleted. If the duplicate carried
 * fresher data, the operator should hand-merge before running this.
 *
 * The Account table is INTENTIONALLY in the reassignment list. Moving
 * the Google `Account` row from the duplicate to the keeper is the
 * whole point — that's the linkage that makes future sign-ins land on
 * the right User.
 *
 * Some unique constraints (e.g. ProjectMember(userId, projectId),
 * MilestoneAssignee(milestoneId, userId)) can fail if the keeper
 * already has a row for the same scope. Those collisions are handled
 * row-by-row: duplicate's row is deleted instead of being moved.
 *
 * Safety
 * ──────
 * DRY-RUN by default. Set DRY_RUN=false to actually mutate. The script
 * always prints a per-email summary of what it would do or what it
 * did. Run via:
 *
 *   DRY_RUN=true  npx tsx prisma/merge-duplicate-users.ts   # preview
 *   DRY_RUN=false npx tsx prisma/merge-duplicate-users.ts   # commit
 *
 * Or via the package.json shortcut:
 *
 *   npm run merge:duplicate-users           # dry run
 *   DRY_RUN=false npm run merge:duplicate-users   # for real
 */

import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

// Per-table reassignment recipe. Each entry is one Prisma updateMany
// call; the script issues `where: { [column]: dup.id }` and `data:
// { [column]: keeper.id }`. Tables with composite uniques that can
// collide are handled separately below — they are NOT in this list.
const REASSIGNMENTS: { model: string; column: string }[] = [
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
];

// Tables with composite-unique constraints that collide if both the
// duplicate and the keeper already have a row for the same scope.
// Handled in code: for each duplicate row, if a keeper row already
// exists for the same scope, delete the duplicate's row; otherwise
// re-point it to the keeper.
const COMPOSITE_UNIQUE_TABLES = new Set([
  "modulePermission", // (userId, module)
  "entityPermission", // (userId, entityType, entityId)
  "projectMember", // (userId, projectId)
  "milestoneAssignee", // (milestoneId, userId)
]);

const DRY_RUN = (process.env.DRY_RUN ?? "true").toLowerCase() !== "false";

interface DuplicateSet {
  emailLower: string;
  rows: { id: string; email: string; createdAt: Date; role: string }[];
}

async function findDuplicates(): Promise<DuplicateSet[]> {
  // SQL-side group: count emails (lowercased) that appear more than
  // once. Prisma doesn't have first-class case-insensitive groupBy so
  // we pull every email and group in-memory.
  const all = await db.user.findMany({
    select: { id: true, email: true, createdAt: true, role: true },
    orderBy: { createdAt: "asc" },
  });
  const byLower = new Map<string, DuplicateSet["rows"]>();
  for (const u of all) {
    const key = u.email.trim().toLowerCase();
    const arr = byLower.get(key) ?? [];
    arr.push(u);
    byLower.set(key, arr);
  }
  const dups: DuplicateSet[] = [];
  for (const [emailLower, rows] of Array.from(byLower.entries())) {
    if (rows.length > 1) dups.push({ emailLower, rows });
  }
  return dups;
}

interface MergePlan {
  emailLower: string;
  keeper: DuplicateSet["rows"][number];
  duplicates: DuplicateSet["rows"];
  reassignments: { model: string; column: string; from: string; to: string }[];
}

function planMerge(set: DuplicateSet): MergePlan {
  // Earliest createdAt wins. Tie-break by id (deterministic).
  const sorted = [...set.rows].sort((a, b) => {
    const t = a.createdAt.getTime() - b.createdAt.getTime();
    if (t !== 0) return t;
    return a.id.localeCompare(b.id);
  });
  const [keeper, ...duplicates] = sorted;
  const reassignments = duplicates.flatMap((d) =>
    REASSIGNMENTS.map((r) => ({ ...r, from: d.id, to: keeper.id }))
  );
  return { emailLower: set.emailLower, keeper, duplicates, reassignments };
}

async function execute(plan: MergePlan): Promise<void> {
  for (const dup of plan.duplicates) {
    // Composite-unique tables first — they need per-row handling.
    await reassignWithCompositeUnique(
      "modulePermission",
      "userId",
      ["userId", "module"],
      dup.id,
      plan.keeper.id
    );
    await reassignWithCompositeUnique(
      "entityPermission",
      "userId",
      ["userId", "entityType", "entityId"],
      dup.id,
      plan.keeper.id
    );
    await reassignWithCompositeUnique(
      "projectMember",
      "userId",
      ["userId", "projectId"],
      dup.id,
      plan.keeper.id
    );
    await reassignWithCompositeUnique(
      "milestoneAssignee",
      "userId",
      ["milestoneId", "userId"],
      dup.id,
      plan.keeper.id
    );

    // Bulk reassignments for everything else.
    for (const { model, column } of REASSIGNMENTS) {
      if (COMPOSITE_UNIQUE_TABLES.has(model)) continue; // already handled
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const delegate = (db as any)[model];
      if (!delegate?.updateMany) {
        console.warn(`  [skip] ${model}.updateMany not found on PrismaClient`);
        continue;
      }
      await delegate.updateMany({
        where: { [column]: dup.id },
        data: { [column]: plan.keeper.id },
      });
    }

    // Finally, delete the duplicate User row. All FKs have been
    // re-pointed by now; if anything was missed, this raises a FK
    // violation rather than silently leaving an orphan.
    await db.user.delete({ where: { id: dup.id } });
  }
}

/**
 * Re-point a table where the FK column is part of a composite unique.
 * Each duplicate row is moved to the keeper UNLESS the keeper already
 * has a row covering the same scope, in which case the duplicate's
 * row is deleted (the keeper's row wins).
 */
async function reassignWithCompositeUnique(
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

function printPlan(plan: MergePlan, mode: "dry" | "live"): void {
  const banner = mode === "dry" ? "[DRY-RUN]" : "[APPLIED]";
  console.log(
    `\n${banner} ${plan.emailLower}: keep ${plan.keeper.id} (${plan.keeper.role}, created ${plan.keeper.createdAt.toISOString()})`
  );
  for (const d of plan.duplicates) {
    console.log(
      `  drop ${d.id} (${d.role}, created ${d.createdAt.toISOString()})`
    );
  }
  console.log(
    `  reassign rows across ${REASSIGNMENTS.length} columns (+ 4 composite-unique tables handled per-row)`
  );
}

async function main(): Promise<void> {
  console.log(
    `merge-duplicate-users: DRY_RUN=${DRY_RUN ? "true (default)" : "false"}\n`
  );
  const sets = await findDuplicates();
  if (sets.length === 0) {
    console.log("No duplicate emails found. Nothing to do.");
    return;
  }
  console.log(`Found ${sets.length} duplicate email set(s).`);

  for (const set of sets) {
    const plan = planMerge(set);
    if (DRY_RUN) {
      printPlan(plan, "dry");
      continue;
    }
    await execute(plan);
    printPlan(plan, "live");
  }

  if (DRY_RUN) {
    console.log(
      "\nNo changes made. Re-run with DRY_RUN=false to apply."
    );
  } else {
    console.log("\nDone.");
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
