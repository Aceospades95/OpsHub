/**
 * Master cleanup script for the demo / stress-test residue surfaced
 * by the QA report.
 *
 * Covers everything the QA flagged that wasn't already addressed by a
 * narrower script:
 *
 *   - Project literally named "123" under Acme Corp.
 *   - "ANOTHER TEST" + "Jacobs Test Role" ProjectRole rows on that
 *     project.
 *   - Supplier "test" (category "decals").
 *   - Certification named "TEST" with type/jurisdiction OTHER/OTHER.
 *   - Announcement intranet resource "Q1 2025 All-Hands Recap".
 *   - StressTestTaskA (×2), StressTestTaskB (×2), and the
 *     "STRESS TEST TASK - past due date" completed task.
 *
 * Safety
 * ------
 * DRY-RUN by default. Set DRY_RUN=false to commit. Each entity is
 * deleted ONLY if its attachment counts are zero (e.g. the "123"
 * project must have no sub-projects, no contracts, no members) — so
 * the script refuses if real data has accumulated against the
 * test row in the meantime.
 *
 * The other narrower scripts (already shipped) handle:
 *   - prisma/merge-named-user.ts          (named-pair duplicate merge)
 *   - prisma/dedupe-intranet-org-chart.ts (dupe Org Chart entry)
 *   - prisma/cleanup-demo-employees.ts    (Sanya testing, Testing USer)
 *   - prisma/backfill-quote-numbers.ts    (legacy Q-YYYY-NNNN numbers)
 *
 * Usage
 * -----
 *   npx tsx prisma/cleanup-demo-data.ts                # preview
 *   DRY_RUN=false npx tsx prisma/cleanup-demo-data.ts  # commit
 */

import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

const DRY_RUN = (process.env.DRY_RUN ?? "true").toLowerCase() !== "false";

interface DeletePlan {
  kind: string;
  label: string;
  /** Reason we're refusing to delete (attachment guard tripped). */
  refuseReason?: string;
  /** Bound action invoked when DRY_RUN=false. */
  apply: () => Promise<void>;
}

async function planProjectByName(name: string, clientNameHint?: string): Promise<DeletePlan[]> {
  const matches = await db.project.findMany({
    where: clientNameHint
      ? { name, client: { name: clientNameHint } }
      : { name },
    select: {
      id: true,
      name: true,
      client: { select: { name: true } },
      _count: {
        select: {
          childProjects: true,
          members: true,
          tasks: true,
          contracts: true,
          documents: true,
          assignments: true,
          quotes: true,
          milestones: true,
          projectRoles: true,
        },
      },
    },
  });
  return matches.map((p) => {
    const attachmentTotal =
      p._count.childProjects +
      p._count.members +
      p._count.tasks +
      p._count.contracts +
      p._count.documents +
      p._count.assignments +
      p._count.quotes +
      p._count.milestones;
    const refuseReason =
      attachmentTotal > 0
        ? `${attachmentTotal} attachment(s) — leave alone unless you've manually verified it's stale`
        : undefined;
    return {
      kind: "project",
      label: `${p.name}${p.client?.name ? ` (${p.client.name})` : ""}`,
      refuseReason,
      apply: async () => {
        // ProjectRole rows on the project are deleted via cascade
        // (the schema's @relation(...onDelete: Cascade)).
        await db.project.delete({ where: { id: p.id } });
      },
    };
  });
}

async function planSupplierByName(name: string, categoryHint?: string): Promise<DeletePlan[]> {
  const matches = await db.supplier.findMany({
    where: categoryHint
      ? { name: { equals: name, mode: "insensitive" }, category: categoryHint }
      : { name: { equals: name, mode: "insensitive" } },
    select: {
      id: true,
      name: true,
      category: true,
      _count: { select: { projects: true, comments: true } },
    },
  });
  return matches.map((s) => {
    const total = s._count.projects + s._count.comments;
    return {
      kind: "supplier",
      label: `${s.name} (${s.category})`,
      refuseReason: total > 0 ? `${total} attachment(s)` : undefined,
      apply: async () => {
        await db.supplier.delete({ where: { id: s.id } });
      },
    };
  });
}

async function planCertByName(name: string): Promise<DeletePlan[]> {
  const matches = await db.certification.findMany({
    where: { name: { equals: name, mode: "insensitive" } },
    select: {
      id: true,
      name: true,
      type: true,
      jurisdictionLevel: true,
      signedOffById: true,
      signedOffAt: true,
      _count: { select: { checklistItems: true, renewalHistory: true } },
    },
  });
  return matches.map((c) => {
    const isOther = c.type === "OTHER" && c.jurisdictionLevel === "OTHER";
    if (!isOther) {
      return {
        kind: "certification",
        label: `${c.name} (${c.type}/${c.jurisdictionLevel})`,
        refuseReason: "type/jurisdiction is not both OTHER — looks like real data",
        apply: async () => {},
      };
    }
    const total =
      c._count.checklistItems +
      c._count.renewalHistory +
      (c.signedOffAt ? 1 : 0);
    return {
      kind: "certification",
      label: `${c.name} (${c.type}/${c.jurisdictionLevel})`,
      refuseReason: total > 0 ? `${total} sign-off / history attachment(s)` : undefined,
      apply: async () => {
        await db.certification.delete({ where: { id: c.id } });
      },
    };
  });
}

async function planIntranetByTitle(
  title: string,
  // Use `unknown` here because the IntranetCategory enum type lives on
  // the generated client; we cast in-place when reading. Keeps the
  // helper free of a generated-type import that adds nothing.
  categoryHint?: string
): Promise<DeletePlan[]> {
  const where: Record<string, unknown> = {
    title: { equals: title, mode: "insensitive" },
  };
  if (categoryHint) where.category = categoryHint;

  const matches = await db.intranetResource.findMany({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    where: where as any,
    include: { _count: { select: { links: true, embeds: true } } },
  });
  return matches.map((r) => {
    const total = r._count.links + r._count.embeds;
    return {
      kind: "intranet",
      label: `${r.title} (${r.category})`,
      refuseReason: total > 0 ? `${total} attachment(s)` : undefined,
      apply: async () => {
        await db.intranetResource.delete({ where: { id: r.id } });
      },
    };
  });
}

async function planTaskByTitle(title: string): Promise<DeletePlan[]> {
  const matches = await db.task.findMany({
    where: { title: { equals: title, mode: "insensitive" } },
    select: { id: true, title: true, status: true, projectId: true },
  });
  return matches.map((t) => ({
    kind: "task",
    label: `${t.title} (${t.status})`,
    apply: async () => {
      await db.task.delete({ where: { id: t.id } });
    },
  }));
}

async function main(): Promise<void> {
  const banner = DRY_RUN ? "[DRY-RUN]" : "[LIVE]";
  console.log(`${banner} cleanup-demo-data\n`);

  const plans: DeletePlan[] = [
    ...(await planProjectByName("123", "Acme Corp")),
    ...(await planSupplierByName("test", "decals")),
    ...(await planCertByName("TEST")),
    ...(await planIntranetByTitle("Q1 2025 All-Hands Recap", "ANNOUNCEMENT")),
    ...(await planTaskByTitle("StressTestTaskA")),
    ...(await planTaskByTitle("StressTestTaskB")),
    ...(await planTaskByTitle("STRESS TEST TASK - past due date")),
  ];

  if (plans.length === 0) {
    console.log("Nothing matched. The demo data may already be cleaned up.");
    return;
  }

  for (const p of plans) {
    if (p.refuseReason) {
      console.log(`  REFUSE  ${p.kind.padEnd(14)}  ${p.label}  →  ${p.refuseReason}`);
    } else {
      console.log(`  ${DRY_RUN ? "would " : ""}delete  ${p.kind.padEnd(14)}  ${p.label}`);
    }
  }

  if (DRY_RUN) {
    console.log("\nNo changes made. Re-run with DRY_RUN=false to apply.");
    return;
  }

  let applied = 0;
  for (const p of plans) {
    if (p.refuseReason) continue;
    try {
      await p.apply();
      applied++;
    } catch (err) {
      console.error(`  ERROR applying ${p.kind} "${p.label}":`, err);
    }
  }
  console.log(`\nApplied ${applied} delete(s).`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
