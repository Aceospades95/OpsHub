"use server";

import { db } from "@/lib/db";
import { requireAuth } from "@/lib/permissions";
import { revalidatePath } from "next/cache";
import {
  SOFT_DELETE_ENTITIES,
  findSoftDeleteEntity,
  hardDeleteRow,
  restoreRow,
  DEFAULT_RETENTION_DAYS,
} from "@/lib/soft-delete";
import type { DynamicDelegateMap } from "@/lib/dynamic-delegate";

/**
 * Server actions backing /admin/recovery.
 *
 * Listing: handled inline in the page (Server Component pulls every
 *   soft-deleted row across the registry).
 * Restore: clear deletedAt — row reappears in list views.
 * Permanent delete: hard-delete the row immediately (admin override
 *   for "I want this gone now, don't wait the 30 days").
 */

interface RestoreInput {
  entityType: string;
  id: string;
}

export async function restoreEntity(
  input: RestoreInput
): Promise<{ success: true; label: string } | { error: string }> {
  const user = await requireAuth();
  if (user.role !== "ADMIN") return { error: "Admin access required" };

  const entity = findSoftDeleteEntity(input.entityType);
  if (!entity) return { error: `Unknown entity type "${input.entityType}"` };

  try {
    const result = await restoreRow(entity, input.id, user.id);
    revalidatePath("/admin/recovery");
    return { success: true, label: result.label };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Restore failed" };
  }
}

export async function permanentlyDeleteEntity(
  input: RestoreInput
): Promise<{ success: true } | { error: string }> {
  const user = await requireAuth();
  if (user.role !== "ADMIN") return { error: "Admin access required" };

  const entity = findSoftDeleteEntity(input.entityType);
  if (!entity) return { error: `Unknown entity type "${input.entityType}"` };

  try {
    const result = await hardDeleteRow(entity, input.id, user.id);
    if (!result.deleted) {
      return { error: "Row not found (already purged?)" };
    }
    revalidatePath("/admin/recovery");
    return { success: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Permanent delete failed" };
  }
}

/**
 * Read every soft-deleted row across the registry. Used by the
 * /admin/recovery server component.
 *
 * Returns an array of { entityType, id, label, deletedAt, daysLeft,
 * href } so the UI can group + render uniformly.
 */
export async function listSoftDeletedRows(
  retentionDays = DEFAULT_RETENTION_DAYS
): Promise<
  {
    entityType: string;
    pluralLabel: string;
    singularLabel: string;
    id: string;
    label: string;
    deletedAt: Date;
    daysLeft: number;
    href: string;
  }[]
> {
  const out: {
    entityType: string;
    pluralLabel: string;
    singularLabel: string;
    id: string;
    label: string;
    deletedAt: Date;
    daysLeft: number;
    href: string;
  }[] = [];

  const cutoffMs = retentionDays * 24 * 60 * 60 * 1000;

  for (const entity of SOFT_DELETE_ENTITIES) {
    const delegate = (db as unknown as DynamicDelegateMap)[entity.prismaModel];
    const rows = await delegate.findMany({
      where: { deletedAt: { not: null } },
      select: {
        id: true,
        deletedAt: true,
        [entity.labelField]: true,
      },
      orderBy: { deletedAt: "desc" },
    });
    for (const r of rows) {
      if (!r.deletedAt) continue;
      const elapsedMs = Date.now() - r.deletedAt.getTime();
      const daysLeft = Math.max(
        0,
        Math.ceil((cutoffMs - elapsedMs) / (24 * 60 * 60 * 1000))
      );
      out.push({
        entityType: entity.entityType,
        pluralLabel: entity.pluralLabel,
        singularLabel: entity.singularLabel,
        id: r.id,
        label: String(r[entity.labelField] ?? "(unnamed)"),
        deletedAt: r.deletedAt,
        daysLeft,
        href: entity.hrefForId(r.id),
      });
    }
  }

  out.sort((a, b) => b.deletedAt.getTime() - a.deletedAt.getTime());
  return out;
}
