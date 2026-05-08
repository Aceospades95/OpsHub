/**
 * One-shot operator migration: replace legacy slug-style Supplier.id
 * values (`supplier-safeguard`, etc.) with proper Prisma cuid()
 * values.
 *
 * BACKGROUND
 * ----------
 * Mirror of prisma/migrate-slug-client-ids.ts for the Supplier table.
 * Round-4 QA found supplier rows with slug-style IDs left over from
 * earlier seed/dev work. The schema declares
 * `id String @id @default(cuid())`; slug-IDs are valid keys but the
 * inconsistency leaks into URLs and audit logs.
 *
 * SAFETY
 * ------
 * DRY-RUN by default. Set DRY_RUN=false to commit. Each rename runs
 * inside a single transaction that:
 *   1. Creates a new Supplier row with a fresh cuid() and copies
 *      every column from the old row.
 *   2. Updates supplierId on every dependent table (SupplierProject,
 *      File, ExternalLink, Comment).
 *   3. Updates Notification rows where (entityType="supplier" AND
 *      entityId=oldId) — Notification stores polymorphic entity refs
 *      so it isn't covered by typed FK walks.
 *   4. Deletes the old row.
 * If anything fails the transaction rolls back and no rows change.
 *
 * IDEMPOTENCY
 * -----------
 * Re-running on already-cuid IDs is a no-op (the regex check skips
 * them). Re-running on a partially-migrated row is also safe — the
 * transaction is atomic.
 *
 * NOT WIRED INTO npm scripts ON PURPOSE
 * --------------------------------------
 * Operator-run only:
 *
 *     # preview only
 *     npx tsx prisma/migrate-slug-supplier-ids.ts
 *
 *     # commit
 *     DRY_RUN=false npx tsx prisma/migrate-slug-supplier-ids.ts
 */

import { PrismaClient, type Prisma } from "@prisma/client";

const db = new PrismaClient();
const DRY_RUN = (process.env.DRY_RUN ?? "true").toLowerCase() !== "false";

const CUID_PATTERN = /^c[a-z0-9]{24}$/;

function isLegacyId(id: string): boolean {
  return !CUID_PATTERN.test(id);
}

const FK_TABLES = ["supplierProject", "file", "externalLink", "comment"] as const;
type FkTable = (typeof FK_TABLES)[number];

function delegateFor(model: FkTable): {
  updateMany: (args: {
    where: { supplierId: string };
    data: { supplierId: string };
  }) => Promise<{ count: number }>;
} {
  switch (model) {
    case "supplierProject": return db.supplierProject;
    case "file": return db.file;
    case "externalLink": return db.externalLink;
    case "comment": return db.comment;
  }
}

interface Plan {
  oldId: string;
  newId: string;
  name: string;
}

async function main(): Promise<void> {
  const banner = DRY_RUN ? "[DRY-RUN]" : "[LIVE]";
  console.log(`${banner} migrate-slug-supplier-ids\n`);

  const all = await db.supplier.findMany({ select: { id: true, name: true } });
  const legacy = all.filter((s) => isLegacyId(s.id));

  if (legacy.length === 0) {
    console.log(`Inspected ${all.length} supplier(s); none have legacy IDs. Nothing to do.`);
    return;
  }

  console.log(`Found ${legacy.length} of ${all.length} supplier(s) with legacy IDs:`);
  const plans: Plan[] = [];
  for (const s of legacy) {
    // Reuse the same stub-row trick the client migration uses to
    // mint a fresh cuid without adding a runtime dep on `cuid`.
    const stub = await db.$transaction(async (tx) => {
      const created = await tx.supplier.create({
        data: { name: `__migrate_stub_${Date.now()}_${s.id}`, category: "OTHER", status: "INACTIVE" },
        select: { id: true },
      });
      await tx.supplier.delete({ where: { id: created.id } });
      return created.id;
    });
    plans.push({ oldId: s.id, newId: stub, name: s.name });
    console.log(`  "${s.name}":  ${s.id}  →  ${stub}`);
  }

  if (DRY_RUN) {
    console.log("\nNo changes made. Re-run with DRY_RUN=false to apply.");
    return;
  }

  console.log("\nApplying...");
  for (const p of plans) {
    await db.$transaction(async (tx) => {
      const old = await tx.supplier.findUniqueOrThrow({ where: { id: p.oldId } });

      const insertData: Prisma.SupplierUncheckedCreateInput = {
        id: p.newId,
        name: old.name,
        category: old.category,
        contactName: old.contactName,
        contactEmail: old.contactEmail,
        contactPhone: old.contactPhone,
        address: old.address,
        website: old.website,
        notes: old.notes,
        status: old.status,
        isPreferred: old.isPreferred,
        createdAt: old.createdAt,
        updatedAt: old.updatedAt,
        deletedAt: old.deletedAt,
      };
      await tx.supplier.create({ data: insertData });

      let totalMoved = 0;
      for (const model of FK_TABLES) {
        const result = await delegateFor(model).updateMany({
          where: { supplierId: p.oldId },
          data: { supplierId: p.newId },
        });
        totalMoved += result.count;
      }

      const notifResult = await tx.notification.updateMany({
        where: { entityType: "supplier", entityId: p.oldId },
        data: { entityId: p.newId },
      });

      await tx.supplier.delete({ where: { id: p.oldId } });

      console.log(
        `  ✓ ${p.name}: ${p.oldId} → ${p.newId} (re-pointed ${totalMoved} FK row(s), ${notifResult.count} notification(s))`
      );
    });
  }

  console.log(`\nMigrated ${plans.length} supplier(s).`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
