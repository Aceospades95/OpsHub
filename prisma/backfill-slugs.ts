/**
 * One-shot operator backfill: populate the new `slug` columns on
 * Client / Project / IntranetResource for rows that exist with a
 * cuid id but no slug.
 *
 * BACKGROUND
 * ----------
 * Round-8 added a nullable `slug` column to each of these tables
 * + wired the create paths to fill it on every new row. Existing
 * rows that pre-date the migration have slug=NULL; their detail
 * pages still resolve via the cuid fallback in the page resolver,
 * but list-page hrefs prefer the slug when present, so backfilled
 * rows get the friendlier URL too.
 *
 * SAFETY
 * ------
 * DRY-RUN by default. Set DRY_RUN=false to commit. Each row's slug
 * is generated from its name/title via the same slugify +
 * ensureUniqueSlug helpers the create actions use, so collisions
 * with existing slugs (or with the row's own legacy slug-style id
 * like `client-acme`) are resolved by appending -2, -3, etc.
 *
 * IDEMPOTENCY
 * -----------
 * Re-running on a fully-backfilled table is a no-op (the WHERE
 * filters out rows where slug is already non-null).
 *
 * NOT WIRED INTO npm scripts ON PURPOSE
 * --------------------------------------
 * Operator-run only:
 *
 *     # preview
 *     npx tsx prisma/backfill-slugs.ts
 *
 *     # commit
 *     DRY_RUN=false npx tsx prisma/backfill-slugs.ts
 */

import { PrismaClient } from "@prisma/client";
import { slugify, ensureUniqueSlug } from "../src/lib/slug";

const db = new PrismaClient();
const DRY_RUN = (process.env.DRY_RUN ?? "true").toLowerCase() !== "false";

interface Plan {
  table: "client" | "project" | "intranetResource";
  id: string;
  label: string;
  slug: string;
}

async function planClients(): Promise<Plan[]> {
  const rows = await db.client.findMany({
    where: { slug: null },
    select: { id: true, name: true },
    orderBy: { createdAt: "asc" },
  });
  const plans: Plan[] = [];
  for (const row of rows) {
    const slug = await ensureUniqueSlug(slugify(row.name), async (s) => {
      const taken = await db.client.findUnique({ where: { slug: s }, select: { id: true } });
      return taken !== null && taken.id !== row.id;
    });
    plans.push({ table: "client", id: row.id, label: row.name, slug });
  }
  return plans;
}

async function planProjects(): Promise<Plan[]> {
  const rows = await db.project.findMany({
    where: { slug: null },
    select: { id: true, name: true },
    orderBy: { createdAt: "asc" },
  });
  const plans: Plan[] = [];
  for (const row of rows) {
    const slug = await ensureUniqueSlug(slugify(row.name), async (s) => {
      const taken = await db.project.findUnique({ where: { slug: s }, select: { id: true } });
      return taken !== null && taken.id !== row.id;
    });
    plans.push({ table: "project", id: row.id, label: row.name, slug });
  }
  return plans;
}

async function planIntranet(): Promise<Plan[]> {
  const rows = await db.intranetResource.findMany({
    where: { slug: null },
    select: { id: true, title: true },
    orderBy: { createdAt: "asc" },
  });
  const plans: Plan[] = [];
  for (const row of rows) {
    const slug = await ensureUniqueSlug(slugify(row.title), async (s) => {
      const taken = await db.intranetResource.findUnique({ where: { slug: s }, select: { id: true } });
      return taken !== null && taken.id !== row.id;
    });
    plans.push({ table: "intranetResource", id: row.id, label: row.title, slug });
  }
  return plans;
}

async function applyPlan(p: Plan): Promise<void> {
  if (p.table === "client") {
    await db.client.update({ where: { id: p.id }, data: { slug: p.slug } });
  } else if (p.table === "project") {
    await db.project.update({ where: { id: p.id }, data: { slug: p.slug } });
  } else {
    await db.intranetResource.update({ where: { id: p.id }, data: { slug: p.slug } });
  }
}

async function main(): Promise<void> {
  const banner = DRY_RUN ? "[DRY-RUN]" : "[LIVE]";
  console.log(`${banner} backfill-slugs\n`);

  const [clientPlans, projectPlans, intranetPlans] = await Promise.all([
    planClients(),
    planProjects(),
    planIntranet(),
  ]);
  const all = [...clientPlans, ...projectPlans, ...intranetPlans];

  if (all.length === 0) {
    console.log("Every row already has a slug. Nothing to do.");
    return;
  }

  console.log(`Planning ${all.length} slug update(s):`);
  console.log(`  ${clientPlans.length} client(s)`);
  console.log(`  ${projectPlans.length} project(s)`);
  console.log(`  ${intranetPlans.length} intranet resource(s)\n`);
  for (const p of all) {
    console.log(`  ${p.table}.${p.id}  "${p.label}"  →  /${p.table === "intranetResource" ? "intranet" : p.table + "s"}/${p.slug}`);
  }

  if (DRY_RUN) {
    console.log("\nNo changes made. Re-run with DRY_RUN=false to apply.");
    return;
  }

  console.log("\nApplying...");
  for (const p of all) {
    try {
      await applyPlan(p);
      console.log(`  ✓ ${p.table}.${p.id} → ${p.slug}`);
    } catch (err) {
      console.error(`  ✗ ${p.table}.${p.id} → ${p.slug}: ${err instanceof Error ? err.message : err}`);
    }
  }
  console.log(`\nBackfilled ${all.length} row(s).`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
