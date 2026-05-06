/**
 * Quote-number backfill — bring legacy `Q-YYYY-NNNN` rows in line with
 * the canonical `{CLIENTSLUG}[-{PROJECTSLUG}]-{YYYY}-{NNNN}` scheme
 * produced by `nextQuoteNumber()` in src/lib/quotes/numbering.ts.
 *
 * Background
 * ----------
 * The QA stress test surfaced inconsistent quote numbering on
 * /quotes:
 *
 *   Q-2026-0001                   (Acme)
 *   Q-2026-0002                   (GlobalTech)
 *   GLOBALTECHSO-2026-0003        (GlobalTech)
 *   GLOBALTECHSO-2026-0004        (GlobalTech)
 *
 * The "Q-" prefixed rows pre-date the per-client numbering helper
 * that ships today. New quotes already use CLIENTSLUG-YYYY-NNNN; the
 * stale ones are existing data only.
 *
 * IMPORTANT WARNING — read before running
 * ---------------------------------------
 * Quote numbers usually appear on PDFs, e-signature documents, and
 * email exchanges with the client. Re-numbering them retroactively
 * means:
 *
 *   - PDFs you've already sent to a client will have a different
 *     quote number than what's in OpsHub now.
 *   - "Quote Q-2026-0001" referenced in a saved email thread will no
 *     longer match a row in the database.
 *   - Any external integration (CRM, accounting export) that stored
 *     the OpsHub quote number as a foreign key will dangle.
 *
 * Only run this script if those consequences are acceptable. For most
 * tenants the right answer is: leave the legacy `Q-` rows alone and
 * accept the visual inconsistency as a one-time migration tail.
 *
 * Safety
 * ------
 * DRY-RUN by default. Set DRY_RUN=false to mutate. The script always
 * prints the rename plan first.
 *
 * Usage
 * -----
 *   npx tsx prisma/backfill-quote-numbers.ts                # preview
 *   DRY_RUN=false npx tsx prisma/backfill-quote-numbers.ts  # commit
 */

import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

const DRY_RUN = (process.env.DRY_RUN ?? "true").toLowerCase() !== "false";

const LEGACY_PATTERN = /^Q-(\d{4})-(\d{4,})$/;

/** Lift the slug-extraction logic from src/lib/quotes/numbering.ts to
 *  avoid the prisma script depending on the Next.js source tree. */
function makeSlug(name: string): string {
  return name.replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(0, 12);
}

async function main(): Promise<void> {
  console.log(
    `backfill-quote-numbers: DRY_RUN=${DRY_RUN ? "true (default)" : "false"}\n`
  );

  const candidates = await db.quote.findMany({
    where: {
      // Use a startsWith filter to narrow the scan; exact regex match
      // happens in JS below.
      quoteNumber: { startsWith: "Q-" },
    },
    select: {
      id: true,
      quoteNumber: true,
      title: true,
      client: { select: { name: true } },
      project: { select: { name: true } },
    },
  });

  const renames: { id: string; from: string; to: string; title: string }[] = [];
  for (const q of candidates) {
    const m = LEGACY_PATTERN.exec(q.quoteNumber);
    if (!m) continue; // not actually a legacy Q-YYYY-NNNN
    const [, year, seq] = m;
    const clientSlug = q.client?.name ? makeSlug(q.client.name) : null;
    if (!clientSlug) {
      console.warn(
        `[skip] ${q.quoteNumber}: client name produced an empty slug; ` +
          "rename by hand if needed."
      );
      continue;
    }
    const projectSlug = q.project?.name ? makeSlug(q.project.name) : null;
    const newNumber = projectSlug
      ? `${clientSlug}-${projectSlug}-${year}-${seq}`
      : `${clientSlug}-${year}-${seq}`;
    if (newNumber === q.quoteNumber) continue; // already canonical
    renames.push({ id: q.id, from: q.quoteNumber, to: newNumber, title: q.title });
  }

  if (renames.length === 0) {
    console.log("No legacy Q- quote numbers found. Nothing to do.");
    return;
  }

  console.log(`Found ${renames.length} legacy quote number(s):\n`);
  for (const r of renames) {
    console.log(`  ${r.from}  →  ${r.to}     (${r.title || "(untitled)"})`);
  }

  if (DRY_RUN) {
    console.log(
      "\nNo changes made. Re-run with DRY_RUN=false to apply.\n" +
        "WARNING: see the file header before applying — quote numbers " +
        "leak into PDFs/emails sent to clients and may not be safe to rename."
    );
    return;
  }

  // Collisions — guard against renaming row A to a number that already
  // exists on row B (the canonical scheme is on a unique index).
  const targets = await db.quote.findMany({
    where: { quoteNumber: { in: renames.map((r) => r.to) } },
    select: { quoteNumber: true },
  });
  if (targets.length > 0) {
    console.error(
      "\nERROR: target quote numbers already exist:\n" +
        targets.map((t) => `  ${t.quoteNumber}`).join("\n") +
        "\nRefusing to rename. Resolve collisions by hand and re-run."
    );
    process.exitCode = 1;
    return;
  }

  for (const r of renames) {
    await db.quote.update({
      where: { id: r.id },
      data: { quoteNumber: r.to },
    });
    console.log(`  renamed ${r.from} → ${r.to}`);
  }
  console.log(`\nRenamed ${renames.length} quote(s).`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
