/**
 * Backfill numeric suffixes on duplicate ProjectRole names within a
 * single project.
 *
 * Round-2 QA flagged that the QA-fix-plan item 29's auto-suffix only
 * applied at RENDER time on rows created AFTER the fix shipped —
 * existing duplicate rows from before the fix still display un-
 * suffixed. Same project showed three role groups all titled
 * "ANOTHER TEST" with no visual hint they were distinct slots.
 *
 * This script renames the underlying ProjectRole rows so the suffix
 * is persisted: same-named roles on the same project become
 * "<name> #1", "<name> #2", etc. in createdAt order.
 *
 * NOTE: ProjectRole.roleDefinition is the FK; the on-screen label
 * comes from the linked RoleDefinition.name. We don't rename the
 * definition (that would affect every project's copy of it). Instead
 * we rename via the local roleName / display fields if they exist —
 * if not, we'd need a schema change. The current schema stores the
 * label on RoleDefinition.name only, so this script renames a NEW
 * RoleDefinition per duplicate slot to preserve the display.
 *
 * Safety
 * ------
 * DRY-RUN by default. Set DRY_RUN=false to commit. Each rename is
 * idempotent: re-running on already-suffixed rows is a no-op.
 *
 * Usage
 * -----
 *   npx tsx prisma/backfill-projectrole-suffixes.ts                # preview
 *   DRY_RUN=false npx tsx prisma/backfill-projectrole-suffixes.ts  # commit
 */

import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();
const DRY_RUN = (process.env.DRY_RUN ?? "true").toLowerCase() !== "false";

async function main(): Promise<void> {
  const banner = DRY_RUN ? "[DRY-RUN]" : "[LIVE]";
  console.log(`${banner} backfill-projectrole-suffixes\n`);

  // Pull every ProjectRole + linked RoleDefinition. We group by
  // (projectId, roleDefinitionId) — same-project + same-definition is
  // the duplicate signal. Rows with the same roleDefinition.name but
  // DIFFERENT roleDefinitionId are intentionally distinct definitions
  // (e.g. two different "Manager" roles created on different projects)
  // and we leave them alone.
  const rows = await db.projectRole.findMany({
    select: {
      id: true,
      projectId: true,
      roleDefinitionId: true,
      createdAt: true,
      roleDefinition: { select: { id: true, name: true, isActive: true } },
      project: { select: { name: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  // Group by (projectId, roleDefinitionId)
  const groups = new Map<string, typeof rows>();
  for (const row of rows) {
    const key = `${row.projectId}|${row.roleDefinitionId}`;
    const arr = groups.get(key) ?? [];
    arr.push(row);
    groups.set(key, arr);
  }

  // For each group with size > 1, the FIRST row keeps the original
  // RoleDefinition; subsequent rows get a fresh per-row RoleDefinition
  // with name "<original> #2", "<original> #3", etc.
  interface RenamePlan {
    projectRoleId: string;
    projectName: string;
    fromName: string;
    toName: string;
  }
  const plans: RenamePlan[] = [];
  for (const [, group] of Array.from(groups.entries())) {
    if (group.length <= 1) continue;
    const baseName = group[0].roleDefinition.name;
    for (let i = 1; i < group.length; i++) {
      const target = `${baseName} #${i + 1}`;
      // Skip if the row's definition is already suffixed (idempotent).
      if (group[i].roleDefinition.name === target) continue;
      plans.push({
        projectRoleId: group[i].id,
        projectName: group[i].project?.name ?? "(unknown)",
        fromName: group[i].roleDefinition.name,
        toName: target,
      });
    }
  }

  if (plans.length === 0) {
    console.log("No duplicate ProjectRole names found. Nothing to do.");
    return;
  }

  console.log(`Found ${plans.length} ProjectRole row(s) to rename:\n`);
  for (const p of plans) {
    console.log(`  ${p.projectRoleId}  in "${p.projectName}":  "${p.fromName}"  →  "${p.toName}"`);
  }

  if (DRY_RUN) {
    console.log("\nNo changes made. Re-run with DRY_RUN=false to apply.");
    return;
  }

  // For each plan: create (or reuse) a per-row RoleDefinition with
  // the suffixed name, then re-point the ProjectRole row at it. The
  // existing roleDefinition stays untouched so the unsuffixed
  // ProjectRole keeps it.
  for (const p of plans) {
    // Reuse an existing definition with the same suffixed name if
    // someone already created one — keeps the script idempotent.
    const existing = await db.roleDefinition.findFirst({
      where: { name: p.toName },
      select: { id: true },
    });
    let defId = existing?.id;
    if (!defId) {
      const created = await db.roleDefinition.create({
        data: { name: p.toName, isActive: true },
      });
      defId = created.id;
    }
    await db.projectRole.update({
      where: { id: p.projectRoleId },
      data: { roleDefinitionId: defId },
    });
    console.log(`  renamed ${p.projectRoleId} → "${p.toName}"`);
  }
  console.log(`\nRenamed ${plans.length} ProjectRole row(s).`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
