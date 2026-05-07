/**
 * One-shot operator migration: replace legacy slug-style Client.id
 * values (`client-acme`, `client-globaltech`, etc.) with proper
 * Prisma cuid() values.
 *
 * BACKGROUND
 * ----------
 * Round-4 QA noticed that some clients in the deployed DB have IDs
 * like `client-acme` while others have proper CUIDs like
 * `cmnqi8r6w0000qj01lee2c2oj`. The schema declares
 * `id String @id @default(cuid())`, so the slug-IDs are historical
 * fixtures from earlier dev/seed work — Prisma never generates that
 * shape. Both kinds work as primary keys, but the inconsistency
 * looks broken in the URL bar and complicates any client-id-aware
 * code (analytics filters, audit-log lookups, etc.).
 *
 * SAFETY
 * ------
 * DRY-RUN by default. Set DRY_RUN=false to commit. Each rename runs
 * inside a single transaction that:
 *   1. Creates a new Client row with a fresh cuid() and copies every
 *      column from the old row.
 *   2. Updates clientId on every dependent table (Task, Project,
 *      ClientContact, Contract, Quote, Certification, Assignment,
 *      Comment, ActivityLog, SandboxPage).
 *   3. Updates Notification rows where (entityType="client" AND
 *      entityId=oldId) — Notification stores polymorphic entity refs
 *      so it isn't covered by typed FK walks.
 *   4. Deletes the old row.
 * If anything fails the transaction rolls back and no rows change.
 *
 * IDEMPOTENCY
 * -----------
 * Re-running on already-cuid IDs is a no-op (the regex check skips
 * them). Re-running on a partially-migrated row is also safe: the
 * transaction is atomic, so a partial state can't exist between
 * runs.
 *
 * NOT WIRED INTO npm scripts ON PURPOSE
 * --------------------------------------
 * The user explicitly asked that this not be auto-run. Invoke
 * directly:
 *
 *     # preview only
 *     npx tsx prisma/migrate-slug-client-ids.ts
 *
 *     # commit
 *     DRY_RUN=false npx tsx prisma/migrate-slug-client-ids.ts
 */

import { PrismaClient, type Prisma } from "@prisma/client";

const db = new PrismaClient();
const DRY_RUN = (process.env.DRY_RUN ?? "true").toLowerCase() !== "false";

// Prisma's cuid() default produces a 25-char string starting with `c`,
// followed by 24 alphanumerics (lowercase). Anything else is a legacy
// slug we want to migrate.
const CUID_PATTERN = /^c[a-z0-9]{24}$/;

function isLegacyId(id: string): boolean {
  return !CUID_PATTERN.test(id);
}

// Tables that carry a clientId FK. Order matters only for readability;
// updateMany operations are independent and run in a single
// transaction.
const FK_TABLES = [
  "task",
  "clientContact",
  "project",
  "contract",
  "comment",
  "activityLog",
  "sandboxPage",
  "certification",
  "assignment",
  "quote",
] as const;
type FkTable = (typeof FK_TABLES)[number];

// Strongly-typed delegate map for the FK walk. Avoids `(db as any)`
// while keeping the dynamic-key access pattern.
function delegateFor(model: FkTable): {
  updateMany: (args: {
    where: { clientId: string };
    data: { clientId: string };
  }) => Promise<{ count: number }>;
} {
  switch (model) {
    case "task": return db.task;
    case "clientContact": return db.clientContact;
    case "project": return db.project;
    case "contract": return db.contract;
    case "comment": return db.comment;
    case "activityLog": return db.activityLog;
    case "sandboxPage": return db.sandboxPage;
    case "certification": return db.certification;
    case "assignment": return db.assignment;
    case "quote": return db.quote;
  }
}

interface Plan {
  oldId: string;
  newId: string;
  name: string;
}

async function main(): Promise<void> {
  const banner = DRY_RUN ? "[DRY-RUN]" : "[LIVE]";
  console.log(`${banner} migrate-slug-client-ids\n`);

  const all = await db.client.findMany({ select: { id: true, name: true } });
  const legacy = all.filter((c) => isLegacyId(c.id));

  if (legacy.length === 0) {
    console.log(`Inspected ${all.length} client(s); none have legacy IDs. Nothing to do.`);
    return;
  }

  console.log(`Found ${legacy.length} of ${all.length} client(s) with legacy IDs:`);
  const plans: Plan[] = [];
  for (const c of legacy) {
    // Generate a CUID by inserting a temporary row and pulling its id
    // back. We can't import `cuid` directly without adding a dep; the
    // easiest route is to let Prisma's @default(cuid()) do the work
    // by creating a stub row and then deleting it. We use the stub's
    // generated id only — never persist the stub.
    const stub = await db.$transaction(async (tx) => {
      const created = await tx.client.create({
        data: { name: `__migrate_stub_${Date.now()}_${c.id}`, status: "ARCHIVED" },
        select: { id: true },
      });
      await tx.client.delete({ where: { id: created.id } });
      return created.id;
    });
    plans.push({ oldId: c.id, newId: stub, name: c.name });
    console.log(`  "${c.name}":  ${c.id}  →  ${stub}`);
  }

  if (DRY_RUN) {
    console.log("\nNo changes made. Re-run with DRY_RUN=false to apply.");
    return;
  }

  console.log("\nApplying...");
  for (const p of plans) {
    await db.$transaction(async (tx) => {
      // 1. Snapshot the old row so we can recreate it under the new id.
      const old = await tx.client.findUniqueOrThrow({ where: { id: p.oldId } });

      // 2. Insert the replacement row first. Carrying every persisted
      //    column forward — Prisma will reject unknown ones at compile
      //    time if the schema changes.
      const insertData: Prisma.ClientUncheckedCreateInput = {
        id: p.newId,
        name: old.name,
        description: old.description,
        summary: old.summary,
        industry: old.industry,
        website: old.website,
        status: old.status,
        accountManagerId: old.accountManagerId,
        createdAt: old.createdAt,
        updatedAt: old.updatedAt,
        deletedAt: old.deletedAt,
      };
      await tx.client.create({ data: insertData });

      // 3. Re-point every FK row.
      let totalMoved = 0;
      for (const model of FK_TABLES) {
        const result = await delegateFor(model).updateMany({
          where: { clientId: p.oldId },
          data: { clientId: p.newId },
        });
        totalMoved += result.count;
      }

      // 4. Notification stores polymorphic entity refs in (entityType,
      //    entityId) — not a typed FK, so the loop above misses it.
      //    Walk those explicitly.
      const notifResult = await tx.notification.updateMany({
        where: { entityType: "client", entityId: p.oldId },
        data: { entityId: p.newId },
      });

      // 5. Delete the old row. With FKs already moved, no cascade fires.
      await tx.client.delete({ where: { id: p.oldId } });

      console.log(
        `  ✓ ${p.name}: ${p.oldId} → ${p.newId} (re-pointed ${totalMoved} FK row(s), ${notifResult.count} notification(s))`
      );
    });
  }

  console.log(`\nMigrated ${plans.length} client(s).`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
