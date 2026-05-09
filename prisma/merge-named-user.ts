/**
 * One-off targeted merge for two duplicate User rows that share the
 * same display name but ended up with different emails (one synthetic
 * `nologin-*@internal.local` placeholder and one canonical address).
 *
 * Background
 * ----------
 * QA stress tests have repeatedly surfaced cases where an SSO sign-in
 * for a user who already had a synthetic-email placeholder created a
 * second User row instead of attaching to the existing one. The result
 * is two active rows with the same name: one carrying the canonical
 * email, the other carrying the synthetic placeholder but holding the
 * bulk of assignments / project memberships / role data.
 *
 *   A: name=$TARGET_NAME  email=$CANONICAL_EMAIL
 *       department=null  jobTitle=null  (light attachments)
 *
 *   B: name=$TARGET_NAME  email=nologin-*@internal.local
 *       department / jobTitle filled in  (heavy attachments)
 *
 * Strategy
 * --------
 *   - Keeper = the row with the synthetic nologin-* email. It carries
 *     the operational data (role, job title, the bulk of assignments).
 *   - Source = the row with email=$CANONICAL_EMAIL. Its FKs get
 *     re-pointed to the keeper.
 *   - After the FK walk, the keeper's email is renamed to the
 *     canonical address so future SSO sign-ins land on the merged row.
 *
 * Safety
 * ------
 * DRY-RUN by default. Set DRY_RUN=false to commit. The script fails
 * loudly if either row can't be found, or if the synthetic-email row
 * actually has FEWER attachments than the canonical-email row (the
 * direction of the merge would lose data — the operator should hand-
 * merge in that case).
 *
 * Configuration (env)
 * -------------------
 *   TARGET_NAME       — display name to match (case-insensitive)
 *   CANONICAL_EMAIL   — email to rename the keeper to
 *   DRY_RUN           — defaults to "true"
 *
 * Usage
 * -----
 *   TARGET_NAME='Alex Admin' CANONICAL_EMAIL='alex.admin@example.com' \
 *     npx tsx prisma/merge-named-user.ts                # dry run
 *
 *   TARGET_NAME='Alex Admin' CANONICAL_EMAIL='alex.admin@example.com' \
 *     DRY_RUN=false npx tsx prisma/merge-named-user.ts  # commit
 */

import { PrismaClient } from "@prisma/client";
import { executeMerge } from "../src/lib/merge-users-fk";

const db = new PrismaClient();

const DRY_RUN = (process.env.DRY_RUN ?? "true").toLowerCase() !== "false";

const SYNTHETIC_EMAIL_PATTERN = /^nologin-.*@internal\.local$/i;

async function main(): Promise<void> {
  const targetName = (process.env.TARGET_NAME ?? "").trim();
  const canonicalEmail = (process.env.CANONICAL_EMAIL ?? "")
    .trim()
    .toLowerCase();

  if (!targetName || !canonicalEmail) {
    console.error(
      "merge-named-user: TARGET_NAME and CANONICAL_EMAIL env vars are required.\n\n" +
        "  TARGET_NAME='Alex Admin' CANONICAL_EMAIL='alex.admin@example.com' \\\n" +
        "    npx tsx prisma/merge-named-user.ts\n"
    );
    process.exitCode = 1;
    return;
  }

  // Pull every active row whose case-insensitive name matches the
  // configured target. A pre-existing manual cleanup will simply leave
  // us with one row and the script will do nothing.
  const candidates = await db.user.findMany({
    where: { name: { equals: targetName, mode: "insensitive" } },
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
    console.log(`merge-named-user: no rows named '${targetName}' found.`);
    return;
  }

  console.log(`Found ${candidates.length} row(s) named '${targetName}':`);
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
      candidates[0].email.trim().toLowerCase() !== canonicalEmail &&
      !SYNTHETIC_EMAIL_PATTERN.test(candidates[0].email)
    ) {
      console.log(
        `Note: the surviving row's email is ${candidates[0].email}, ` +
          `not ${canonicalEmail}. Reset by hand if needed.`
      );
    }
    return;
  }

  if (candidates.length > 2) {
    console.error(
      `\nERROR: expected exactly 2 '${targetName}' rows; found ${candidates.length}. ` +
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
    (c) => c.email.trim().toLowerCase() === canonicalEmail
  );

  if (!keeper || !source) {
    console.error(
      `\nERROR: didn't find one synthetic-email and one ${canonicalEmail} row. ` +
        "The data may have already been hand-merged. Refusing to guess."
    );
    console.error(
      `  keeper (synthetic nologin-*@internal.local): ${keeper?.id ?? "(none)"}`
    );
    console.error(
      `  source (${canonicalEmail}): ${source?.id ?? "(none)"}`
    );
    process.exitCode = 1;
    return;
  }

  // Sanity check: the keeper should have meaningfully more attachments
  // than the source. If they're flipped, refuse — the operator should
  // hand-merge rather than risk losing the larger employee record.
  const keeperLoad =
    keeper._count.assignments + keeper._count.projectMembers;
  const sourceLoad =
    source._count.assignments + source._count.projectMembers;
  if (sourceLoad > keeperLoad) {
    console.error(
      `\nERROR: the ${canonicalEmail} row has MORE attachments than the synthetic-email row. ` +
        "That's the opposite of the documented direction, which means data has shifted. " +
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
      `  rename keeper email → ${canonicalEmail}\n` +
      `  re-point ${sourceLoad} attachment(s) onto keeper`
  );

  if (DRY_RUN) {
    console.log("\nNo changes made. Re-run with DRY_RUN=false to apply.");
    return;
  }

  await executeMerge(db, source.id, keeper.id, {
    targetEmail: canonicalEmail,
  });
  console.log("\nMerge complete. The surviving row holds the canonical email.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
