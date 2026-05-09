/**
 * Merge two User rows by explicit ID — the operator picks the keeper.
 *
 * Used when the email-based merge-duplicate-users.ts can't help, e.g.
 * when the two duplicate rows have *different* emails — for example,
 * a real account with a canonical address and a synthetic-email
 * placeholder record that ended up holding the bulk of assignments.
 *
 * Strategy
 * --------
 * Walk every FK that points at User.id and re-aim it from `from`
 * onto `to`. Composite-unique constraints are handled per-row to
 * avoid Prisma collisions. Optionally rename the keeper's email
 * after the FKs move (so the merged row ends up with the canonical
 * address even when the keeper was the synthetic-email row). Finally,
 * delete the `from` row.
 *
 * Safety
 * ------
 * DRY-RUN by default. Set DRY_RUN=false to commit.
 *
 * Usage
 * -----
 *   FROM=<userId> TO=<userId> npx tsx prisma/merge-users-by-id.ts
 *
 *   # Optional: rename the keeper to a canonical email after the
 *   # FK walk (only applied when DRY_RUN=false).
 *   FROM=<userId> TO=<userId> TARGET_EMAIL=alice@example.com \
 *     npx tsx prisma/merge-users-by-id.ts
 *
 *   # For real:
 *   DRY_RUN=false FROM=<userId> TO=<userId> \
 *     npx tsx prisma/merge-users-by-id.ts
 *
 * The script prints a per-merge summary BEFORE asking for the commit
 * (in DRY_RUN mode it stops there; in live mode it commits inline).
 */

import { PrismaClient } from "@prisma/client";
import { REASSIGNMENTS, executeMerge } from "../src/lib/merge-users-fk";

const db = new PrismaClient();

const DRY_RUN = (process.env.DRY_RUN ?? "true").toLowerCase() !== "false";

async function main(): Promise<void> {
  const fromId = (process.env.FROM ?? "").trim();
  const toId = (process.env.TO ?? "").trim();
  const targetEmail = (process.env.TARGET_EMAIL ?? "").trim() || undefined;

  if (!fromId || !toId) {
    console.error(
      "merge-users-by-id: FROM and TO env vars are required.\n\n" +
        "  FROM=<userId> TO=<userId> npx tsx prisma/merge-users-by-id.ts\n"
    );
    process.exitCode = 1;
    return;
  }

  if (fromId === toId) {
    console.error("merge-users-by-id: FROM and TO are the same id.");
    process.exitCode = 1;
    return;
  }

  const [from, to] = await Promise.all([
    db.user.findUnique({
      where: { id: fromId },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        jobTitle: true,
        isActive: true,
        createdAt: true,
        _count: {
          select: {
            assignments: true,
            projectMembers: true,
            assignedTasks: true,
          },
        },
      },
    }),
    db.user.findUnique({
      where: { id: toId },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        jobTitle: true,
        isActive: true,
        createdAt: true,
        _count: {
          select: {
            assignments: true,
            projectMembers: true,
            assignedTasks: true,
          },
        },
      },
    }),
  ]);

  if (!from) {
    console.error(`merge-users-by-id: FROM user ${fromId} not found.`);
    process.exitCode = 1;
    return;
  }
  if (!to) {
    console.error(`merge-users-by-id: TO user ${toId} not found.`);
    process.exitCode = 1;
    return;
  }

  const banner = DRY_RUN ? "[DRY-RUN]" : "[LIVE]";
  console.log(
    `${banner} merge-users-by-id\n` +
      `  from: ${from.id}  ${from.name}  <${from.email}>  role=${from.role} jobTitle=${from.jobTitle ?? "—"}\n` +
      `        assignments=${from._count.assignments} memberships=${from._count.projectMembers} tasks=${from._count.assignedTasks}\n` +
      `  to:   ${to.id}  ${to.name}  <${to.email}>  role=${to.role} jobTitle=${to.jobTitle ?? "—"}\n` +
      `        assignments=${to._count.assignments} memberships=${to._count.projectMembers} tasks=${to._count.assignedTasks}\n` +
      (targetEmail
        ? `  rename keeper email → ${targetEmail.toLowerCase()}\n`
        : "") +
      `  reassign rows across ${REASSIGNMENTS.length} columns + 4 composite-unique tables`
  );

  if (DRY_RUN) {
    console.log("\nNo changes made. Re-run with DRY_RUN=false to apply.");
    return;
  }

  await executeMerge(db, fromId, toId, { targetEmail });
  console.log("\nMerge complete.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
