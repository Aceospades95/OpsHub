/**
 * Cleanup migration for the demo / test employee rows surfaced by the
 * QA stress test.
 *
 * The QA report flagged two specific entries:
 *
 *   - "Sanya testing"  (email: jakewright95@gmail.com — external Gmail)
 *     No title, no manager, FTE 0, 0 assignments. Sitting under
 *     TOP_OF_ORG.
 *
 *   - "Testing USer"  (sic — the typo is in the seed)
 *     Reports to Jacob Wright. No assignments.
 *
 * Both look like leftover seed / smoke-test data. This script
 * deactivates them (sets isActive=false) rather than hard-deleting,
 * so any FK referencing them (audit logs, etc.) still resolves.
 *
 * Safety
 * ------
 * DRY-RUN by default. Set DRY_RUN=false to commit. The script
 * matches by exact name + email so it's narrow — it WILL refuse if
 * either name resolves to more than one user (i.e. the data has
 * shifted from what the QA report described).
 *
 * Usage
 * -----
 *   npx tsx prisma/cleanup-demo-employees.ts                # preview
 *   DRY_RUN=false npx tsx prisma/cleanup-demo-employees.ts  # commit
 */

import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

const DRY_RUN = (process.env.DRY_RUN ?? "true").toLowerCase() !== "false";

const TARGETS = [
  { name: "Sanya testing", email: "jakewright95@gmail.com" },
  { name: "Testing USer", email: null }, // email shape unknown; match by name alone
];

async function main(): Promise<void> {
  const banner = DRY_RUN ? "[DRY-RUN]" : "[LIVE]";
  console.log(`${banner} cleanup-demo-employees\n`);

  for (const target of TARGETS) {
    const candidates = await db.user.findMany({
      where: target.email
        ? { name: { equals: target.name, mode: "insensitive" }, email: target.email }
        : { name: { equals: target.name, mode: "insensitive" } },
      select: {
        id: true,
        name: true,
        email: true,
        isActive: true,
        _count: {
          select: { assignments: true, projectMembers: true, assignedTasks: true },
        },
      },
    });

    if (candidates.length === 0) {
      console.log(`  "${target.name}": not found, nothing to do`);
      continue;
    }
    if (candidates.length > 1) {
      console.error(
        `  ERROR: "${target.name}" matched ${candidates.length} rows. Refusing to deactivate (the data has shifted from the QA report).`
      );
      candidates.forEach((c) => {
        console.error(`    - ${c.id}  <${c.email}>  active=${c.isActive}`);
      });
      continue;
    }
    const c = candidates[0];
    if (!c.isActive) {
      console.log(`  "${c.name}" <${c.email}>: already inactive (${c.id}) — skipping`);
      continue;
    }

    const attachmentCount =
      c._count.assignments + c._count.projectMembers + c._count.assignedTasks;
    if (attachmentCount > 0) {
      console.error(
        `  REFUSING to deactivate "${c.name}" — has ${attachmentCount} attachment(s). ` +
          "If this really is test data, run the merge tool first."
      );
      continue;
    }

    if (DRY_RUN) {
      console.log(`  would deactivate "${c.name}" <${c.email}> (${c.id})`);
      continue;
    }

    await db.user.update({
      where: { id: c.id },
      data: { isActive: false, hasLoginAccess: false },
    });
    console.log(`  deactivated "${c.name}" <${c.email}> (${c.id})`);
  }

  if (DRY_RUN) {
    console.log("\nNo changes made. Re-run with DRY_RUN=false to apply.");
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
