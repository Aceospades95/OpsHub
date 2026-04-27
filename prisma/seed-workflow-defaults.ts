/**
 * Seed runner for the three default workflow templates.
 *
 * Run with: `npx tsx prisma/seed-workflow-defaults.ts`
 *
 * Idempotent — if a seeded template with the same name already exists
 * (and is_seed=true), this script skips it. To force-refresh during
 * development, drop the existing row first or rename it.
 *
 * Designed for first-run / local development. In production, run once
 * after deploying the Phase 3 schema. The Phase 4 cron worker will
 * later call this on startup if the table is empty.
 */

import { PrismaClient } from "@prisma/client";
import { DEFAULT_SEED_TEMPLATES } from "../src/lib/workflows/seed-defaults";

const prisma = new PrismaClient();

async function main() {
  // The seed templates need a `createdById`. Pick any active admin to
  // attribute creation to so the records are queryable. If no admin
  // exists yet, fall back to any active user; if neither, abort with
  // a clear message rather than blowing up on a constraint violation.
  const admin = await prisma.user.findFirst({
    where: { role: "ADMIN", isActive: true },
    select: { id: true, email: true },
  });
  const fallback = admin
    ? null
    : await prisma.user.findFirst({
        where: { isActive: true },
        select: { id: true, email: true },
      });
  const creator = admin ?? fallback;

  if (!creator) {
    console.error(
      "No active user found to attribute seed templates to. Run promote-admin first or create a user."
    );
    process.exit(1);
  }

  console.log(
    `Seeding ${DEFAULT_SEED_TEMPLATES.length} default workflow templates (created by ${creator.email}).`
  );

  let created = 0;
  let skipped = 0;
  for (const seed of DEFAULT_SEED_TEMPLATES) {
    const existing = await prisma.workflowTemplate.findFirst({
      where: { name: seed.name, isSeed: true },
      select: { id: true },
    });
    if (existing) {
      skipped++;
      console.log(`  ✓ Skip (already seeded): ${seed.name}`);
      continue;
    }

    const tpl = await prisma.workflowTemplate.create({
      data: {
        name: seed.name,
        description: seed.description,
        type: seed.type,
        subjectEntityType: seed.subjectEntityType,
        isActive: true,
        isSeed: true,
        createdById: creator.id,
        steps: {
          create: seed.steps.map((step, i) => ({
            position: i,
            name: step.name,
            stepType: step.stepType,
            config: JSON.stringify(step.config),
            timingType: step.timingType,
            timingValue: step.timingValue,
            isRequired: step.isRequired,
          })),
        },
      },
    });
    created++;
    console.log(`  + Created: ${tpl.name} (${seed.steps.length} steps)`);
  }

  console.log(`\nDone. ${created} created, ${skipped} skipped.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
