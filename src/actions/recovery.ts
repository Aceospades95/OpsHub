"use server";

import { db } from "@/lib/db";
import { requireAuth } from "@/lib/permissions";
import { revalidatePath } from "next/cache";
import {
  SOFT_DELETE_ENTITIES,
  findSoftDeleteEntity,
  hardDeleteRow,
  restoreRow,
  labelSelection,
  rowLabel,
  DEFAULT_RETENTION_DAYS,
} from "@/lib/soft-delete";
import type { DynamicDelegateMap } from "@/lib/dynamic-delegate";

/**
 * Restored / purged rows must reappear (or vanish) on their module's
 * cached list + detail pages, not just /admin/recovery (entity-map.md
 * rule 3). The registry's hrefForId gives us the detail path; the list
 * path is its first segment. revalidating both plus /dashboard covers
 * every page a recovered entity can surface on without wiring a
 * per-entity helper for each of the nine soft-deletable models.
 */
function revalidateRecoveredEntity(
  entity: { hrefForId(id: string): string },
  id: string
) {
  const detailPath = entity.hrefForId(id);
  const listPath = "/" + detailPath.split("/").filter(Boolean)[0];
  revalidatePath(detailPath);
  revalidatePath(listPath);
  revalidatePath("/dashboard");
  revalidatePath("/admin/recovery");
}

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
    revalidateRecoveredEntity(entity, input.id);
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
    revalidateRecoveredEntity(entity, input.id);
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
  | { error: string }
  |
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
  // Same gate as restore / permanent-delete above. This is an exported
  // server action (publicly POSTable endpoint), and it enumerates the
  // id + label of every soft-deleted row across the org — without the
  // check, any authenticated user could read the recycle bin.
  const user = await requireAuth();
  if (user.role !== "ADMIN") return { error: "Admin access required" };

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
        ...labelSelection(entity),
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
        label: rowLabel(entity, r) || "(unnamed)",
        deletedAt: r.deletedAt,
        daysLeft,
        href: entity.hrefForId(r.id),
      });
    }
  }

  out.sort((a, b) => b.deletedAt.getTime() - a.deletedAt.getTime());
  return out;
}
