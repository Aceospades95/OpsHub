/**
 * Dedupe the "Org Chart" entry on /intranet.
 *
 * Background
 * ----------
 * The QA stress test surfaced that the Org Chart card on /intranet
 * appeared twice — once as "Org Chart" and once as "Company Org
 * Chart" — both with category=ORG_CHART. Looks like a legacy seed
 * collision rather than a user double-add.
 *
 * Strategy
 * --------
 * Find every IntranetResource with category=ORG_CHART. If there's
 * more than one, keep the EARLIEST createdAt row and archive the
 * others (set published=false instead of deleting, so any links from
 * other surfaces still resolve cleanly). Print the plan and exit when
 * DRY_RUN is true.
 *
 * Safety
 * ------
 * DRY-RUN by default. Set DRY_RUN=false to commit. Touches at most a
 * handful of rows.
 *
 * Usage
 * -----
 *   npx tsx prisma/dedupe-intranet-org-chart.ts                # preview
 *   DRY_RUN=false npx tsx prisma/dedupe-intranet-org-chart.ts  # commit
 */

import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

const DRY_RUN = (process.env.DRY_RUN ?? "true").toLowerCase() !== "false";

async function main(): Promise<void> {
  const orgChartResources = await db.intranetResource.findMany({
    where: { category: "ORG_CHART" },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      title: true,
      published: true,
      pinned: true,
      createdAt: true,
    },
  });

  if (orgChartResources.length <= 1) {
    console.log(
      `Found ${orgChartResources.length} ORG_CHART intranet resource(s). Nothing to dedupe.`
    );
    return;
  }

  const [keeper, ...dupes] = orgChartResources;
  const banner = DRY_RUN ? "[DRY-RUN]" : "[LIVE]";
  console.log(
    `${banner} Found ${orgChartResources.length} ORG_CHART intranet resource(s):\n`
  );
  console.log(
    `  KEEP: ${keeper.id}  "${keeper.title}"  published=${keeper.published}  pinned=${keeper.pinned}  created=${keeper.createdAt.toISOString()}`
  );
  for (const d of dupes) {
    console.log(
      `  ARCHIVE: ${d.id}  "${d.title}"  published=${d.published}  pinned=${d.pinned}  created=${d.createdAt.toISOString()}`
    );
  }

  if (DRY_RUN) {
    console.log(
      "\nNo changes made. Re-run with DRY_RUN=false to archive the duplicates."
    );
    return;
  }

  for (const d of dupes) {
    await db.intranetResource.update({
      where: { id: d.id },
      data: { published: false, pinned: false },
    });
    console.log(`  archived ${d.id}`);
  }
  console.log(`\nArchived ${dupes.length} duplicate Org Chart resource(s).`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
