/**
 * One-off targeted merge for the QA-reported Jacob Wright duplicates.
 *
 * Background (from the QA stress test report)
 * -------------------------------------------
 * Two active "Jacob Wright" employees existed in the Employees table:
 *
 *   A: name="Jacob Wright"  email=j.wright@wynndalco.com
 *       department=null  jobTitle=null  assignments=2  projects=1
 *
 *   B: name="Jacob Wright"  email=nologin-1775667974875@internal.local
 *       department="Vice President"  jobTitle="Vice President"
 *       assignments=7  projects=5
 *
 * Both also showed in the Org Chart as separate cards under
 * TOP_OF_ORG. The synthetic-email row (B) holds the operationally-real
 * employee — VP role, the bulk of assignments — but the canonical
 * email lives on row A. The QA spec is to "merge these two specific
 * records into the VP row, keeping j.wright@wynndalco.com".
 *
 * Strategy
 * --------
 *   - Keeper = the row with the synthetic nologin-* email (the VP
 *     row). It has the correct role, job title, and the bulk of
 *     assignments — preserving it loses the least operational data.
 *   - Source = the row with email=j.wright@wynndalco.com. Its FKs
 *     get re-pointed to the keeper.
 *   - After the FK walk, the keeper's email is renamed to
 *     j.wright@wynndalco.com so the merged row holds the canonical
 *     address (and any future SSO sign-in for that email lands on
 *     the right user).
 *
 * Safety
 * ------
 * DRY-RUN by default. Set DRY_RUN=false to commit. The script
 * fails loudly if either row can't be found (e.g. because the
 * cleanup has already been run, or because someone manually
 * fixed it through the UI).
 *
 * Usage
 * -----
 *   npx tsx prisma/merge-jacob-wright.ts                # dry run
 *   DRY_RUN=false npx tsx prisma/merge-jacob-wright.ts  # commit
 */

import { PrismaClient } from "@prisma/client";
import { executeMerge } from "../src/lib/merge-users-fk";

const db = new PrismaClient();

const DRY_RUN = (process.env.DRY_RUN ?? "true").toLowerCase() !== "false";

const CANONICAL_EMAIL = "j.wright@wynndalco.com";
const SYNTHETIC_EMAIL_PATTERN = /^nologin-.*@internal\.local$/i;
const TARGET_NAME_LOWER = "jacob wright";

async function main(): Promise<void> {
  // Pull every active row whose case-insensitive name matches
  // "Jacob Wright". A pre-existing manual cleanup will simply leave us
  // with one row and the script will do nothing.
  const candidates = await db.user.findMany({
    where: { name: { equals: "Jacob Wright", mode: "insensitive" } },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      jobTitle: true,
      department: true,
      isActive: true,
      createdAt: true,
      _count: {
        select: { assignments: true, projectMembers: true, assignedTasks: true },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  if (candidates.length === 0) {
    console.log("merge-jacob-wright: no rows named 'Jacob Wright' found.");
    return;
  }

  console.log(`Found ${candidates.length} row(s) named 'Jacob Wright':`);
  for (const c of candidates) {
    console.log(
      `  ${c.id}  <${c.email}>  role=${c.role}  jobTitle=${c.jobTitle ?? "—"}  ` +
        `dept=${c.department ?? "—"}  assignments=${c._count.assignments}  ` +
        `projects=${c._count.projectMembers}  tasks=${c._count.assignedTasks}  ` +
        `active=${c.isActive}`
    );
  }

  if (candidates.length === 1) {
    console.log("\nOnly one row exists. Nothing to merge.");
    if (
      candidates[0].email.trim().toLowerCase() !== CANONICAL_EMAIL &&
      !SYNTHETIC_EMAIL_PATTERN.test(candidates[0].email)
    ) {
      console.log(
        `Note: the surviving row's email is ${candidates[0].email}, ` +
          `not ${CANONICAL_EMAIL}. Reset by hand if needed.`
      );
    }
    return;
  }

  if (candidates.length > 2) {
    console.error(
      `\nERROR: expected exactly 2 'Jacob Wright' rows; found ${candidates.length}. ` +
        "Inspect manually — this script is intentionally narrow."
    );
    process.exitCode = 1;
    return;
  }

  // Identify the canonical-email row and the synthetic-email row.
  const keeper = candidates.find((c) =>
    SYNTHETIC_EMAIL_PATTERN.test(c.email)
  );
  const source = candidates.find(
    (c) => c.email.trim().toLowerCase() === CANONICAL_EMAIL
  );

  if (!keeper || !source) {
    console.error(
      "\nERROR: didn't find one synthetic-email and one j.wright@wynndalco.com row. " +
        "The data may have already been hand-merged. Refusing to guess."
    );
    console.error(
      `  keeper (synthetic nologin-*@internal.local): ${keeper?.id ?? "(none)"}`
    );
    console.error(
      `  source (${CANONICAL_EMAIL}): ${source?.id ?? "(none)"}`
    );
    process.exitCode = 1;
    return;
  }

  // Sanity check: the keeper should have meaningfully more assignments
  // than the source. If they're flipped, refuse — the operator should
  // hand-merge rather than risk losing the larger employee record.
  const keeperLoad =
    keeper._count.assignments + keeper._count.projectMembers;
  const sourceLoad =
    source._count.assignments + source._count.projectMembers;
  if (sourceLoad > keeperLoad) {
    console.error(
      "\nERROR: the j.wright@wynndalco.com row has MORE attachments than the synthetic-email row. " +
        "That's the opposite of what the QA report described, which means data has shifted. " +
        "Refusing to merge in the recorded direction. Re-evaluate by hand."
    );
    console.error(`  keeper attachments=${keeperLoad} (synthetic email)`);
    console.error(`  source attachments=${sourceLoad} (canonical email)`);
    process.exitCode = 1;
    return;
  }

  const banner = DRY_RUN ? "[DRY-RUN]" : "[LIVE]";
  console.log(
    `\n${banner} plan:\n` +
      `  keeper (kept): ${keeper.id}  <${keeper.email}>  role=${keeper.role} jobTitle=${keeper.jobTitle}\n` +
      `  source (deleted): ${source.id}  <${source.email}>  role=${source.role} jobTitle=${source.jobTitle ?? "—"}\n` +
      `  rename keeper email → ${CANONICAL_EMAIL}\n` +
      `  re-point ${sourceLoad} attachment(s) onto keeper`
  );

  if (DRY_RUN) {
    console.log("\nNo changes made. Re-run with DRY_RUN=false to apply.");
    return;
  }

  await executeMerge(db, source.id, keeper.id, {
    targetEmail: CANONICAL_EMAIL,
  });
  console.log("\nMerge complete. The surviving row is the VP record with the canonical email.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
