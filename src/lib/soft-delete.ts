/**
 * Soft-delete plumbing.
 *
 * The QA-flagged behavior — Delete cascades aggressively with no
 * undo — is replaced by a 30-day recovery window:
 *
 *   1. The delete actions set `deletedAt = now()` instead of running
 *      `db.<model>.delete()`. Cascade-on-delete still applies when
 *      we eventually hard-delete; in the soft-deleted window the
 *      child rows stay attached but are filtered from list views.
 *   2. Every list / detail / count query the user can reach filters
 *      `deletedAt: null` so soft-deleted rows are invisible.
 *   3. /admin/recovery shows the soft-deleted set with Restore
 *      (clears deletedAt) and Permanently delete buttons. Restoring
 *      reconnects the row to every list view it belonged to.
 *   4. The PURGE_SOFT_DELETED scheduled task hard-deletes rows whose
 *      deletedAt is older than retentionDays (default 30). At that
 *      point the row is gone for good and Prisma's onDelete cascades
 *      run normally.
 *
 * The entity registry below is the single source of truth — list
 * pages, the recovery UI, the scheduled task, and the soft-delete /
 * restore actions all read from it. Adding a soft-deletable entity
 * means: add the deletedAt column to its prisma model, add an entry
 * here, and every consumer picks it up.
 */

import { db } from "@/lib/db";
import { logActivity } from "@/lib/activity";
import type { DynamicDelegateMap } from "@/lib/dynamic-delegate";

/**
 * Default retention. The PURGE_SOFT_DELETED task config can override
 * this per-deployment, but 30 days is the QA-spec default and what
 * the recovery page advertises to users.
 */
export const DEFAULT_RETENTION_DAYS = 30;

/**
 * One entry per soft-deletable model. The `prismaModel` key is the
 * lowercase delegate name on the Prisma client (e.g. `db.project`).
 * The `entityType` is the activity-log entityType + the URL slug used
 * by /admin/recovery (`/admin/recovery?type={entityType}`).
 *
 * `displayLabel` is what shows in the recovery list. `displayPath`
 * builds the link back to the entity's own detail page from a row
 * id, used as the row title link in the recovery UI (when the row is
 * still soft-deleted the link works; once purged it's gone).
 */
export interface SoftDeleteEntity {
  /** Lowercase Prisma delegate name. */
  prismaModel:
    | "project"
    | "client"
    | "contract"
    | "quote"
    | "supplier"
    | "subcontractor"
    | "partnership"
    | "tool"
    | "certification"
    | "intranetResource"
    | "document"
    | "task"
    | "vehicle"
    | "disciplinaryReport";
  /** Activity-log entityType + recovery-page slug. Stable. */
  entityType: string;
  /** Plural label used as the section header on /admin/recovery. */
  pluralLabel: string;
  /** Singular label used in toasts and confirm dialogs. */
  singularLabel: string;
  /** Module key for permission checks. */
  module: string;
  /** Field on the row that produces the user-facing label. */
  labelField: "name" | "title" | "model" | "description";
  /** Link back to the entity's detail page (works while soft-deleted). */
  hrefForId(id: string): string;
}

export const SOFT_DELETE_ENTITIES: readonly SoftDeleteEntity[] = [
  {
    prismaModel: "project",
    entityType: "project",
    pluralLabel: "Projects",
    singularLabel: "project",
    module: "projects",
    labelField: "name",
    hrefForId: (id) => `/projects/${id}`,
  },
  {
    prismaModel: "client",
    entityType: "client",
    pluralLabel: "Clients",
    singularLabel: "client",
    module: "clients",
    labelField: "name",
    hrefForId: (id) => `/clients/${id}`,
  },
  {
    prismaModel: "contract",
    entityType: "contract",
    pluralLabel: "Contracts",
    singularLabel: "contract",
    module: "contracts",
    labelField: "title",
    hrefForId: (id) => `/contracts/${id}`,
  },
  {
    prismaModel: "quote",
    entityType: "quote",
    pluralLabel: "Quotes",
    singularLabel: "quote",
    module: "quotes",
    labelField: "title",
    hrefForId: (id) => `/quotes/${id}`,
  },
  {
    prismaModel: "supplier",
    entityType: "supplier",
    pluralLabel: "Suppliers",
    singularLabel: "supplier",
    module: "suppliers",
    labelField: "name",
    hrefForId: (id) => `/suppliers/${id}`,
  },
  {
    prismaModel: "subcontractor",
    entityType: "subcontractor",
    pluralLabel: "Subcontractors",
    singularLabel: "subcontractor",
    module: "subcontractors",
    labelField: "name",
    hrefForId: (id) => `/subcontractors/${id}`,
  },
  {
    prismaModel: "partnership",
    entityType: "partnership",
    pluralLabel: "Partnerships",
    singularLabel: "partnership",
    module: "partnerships",
    labelField: "name",
    hrefForId: (id) => `/partnerships/${id}`,
  },
  {
    prismaModel: "tool",
    entityType: "tool",
    pluralLabel: "Tools",
    singularLabel: "tool",
    module: "tools",
    labelField: "name",
    hrefForId: (id) => `/tools/${id}`,
  },
  {
    prismaModel: "certification",
    entityType: "certification",
    pluralLabel: "Certifications",
    singularLabel: "certification",
    module: "certifications",
    labelField: "name",
    hrefForId: (id) => `/certifications/${id}`,
  },
  {
    prismaModel: "vehicle",
    entityType: "vehicle",
    pluralLabel: "Vehicles",
    singularLabel: "vehicle",
    module: "fleet",
    labelField: "model",
    hrefForId: (id) => `/fleet/${id}`,
  },
  {
    prismaModel: "disciplinaryReport",
    entityType: "disciplinary-report",
    pluralLabel: "Disciplinary Reports",
    singularLabel: "disciplinary report",
    // HR-sensitive; the recovery page itself is ADMIN-only. No standalone
    // detail page — the href lands on the team list.
    module: "team",
    labelField: "description",
    hrefForId: () => `/team`,
  },
  {
    prismaModel: "intranetResource",
    entityType: "intranet",
    pluralLabel: "Intranet Resources",
    singularLabel: "intranet resource",
    module: "intranet",
    labelField: "title",
    hrefForId: (id) => `/intranet/${id}`,
  },
  {
    prismaModel: "document",
    entityType: "document",
    pluralLabel: "Documents",
    singularLabel: "document",
    module: "projects",
    labelField: "title",
    // Documents are nested under projects; the row carries projectId
    // we read in the recovery UI to build the href.
    hrefForId: (id) => `/documents/${id}`,
  },
  {
    prismaModel: "task",
    entityType: "task",
    pluralLabel: "Tasks",
    singularLabel: "task",
    module: "tasks",
    labelField: "title",
    hrefForId: () => `/tasks`,
  },
];

export function findSoftDeleteEntity(
  entityType: string
): SoftDeleteEntity | undefined {
  return SOFT_DELETE_ENTITIES.find((e) => e.entityType === entityType);
}

/**
 * Cutoff date for "old enough to permanently delete." Anything with
 * deletedAt strictly before this is fair game for the cron.
 */
export function purgeCutoff(retentionDays = DEFAULT_RETENTION_DAYS): Date {
  return new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
}

/**
 * The full filter spread into a Prisma `where` to hide soft-deleted
 * rows from any list / detail query. Inline `{ deletedAt: null }`
 * also works; this is just the common-case helper so call sites
 * read uniformly across modules.
 */
export const NOT_DELETED: { deletedAt: null } = { deletedAt: null };

interface SoftDeleteOptions {
  /** When true, log to ActivityLog. Defaults to true. */
  log?: boolean;
  /** Optional scope for the activity-log row (clientId / projectId). */
  scope?: { clientId?: string | null; projectId?: string | null };
}

/**
 * Generic soft-delete: stamp deletedAt = now() on the row and write
 * an activity-log entry. Returns the row's display label so the
 * caller can surface it in a toast / confirm message.
 *
 * Throws if the row is already soft-deleted (so the action can show
 * an "already in trash" state instead of silently looking like a no-
 * op). Each delete action is responsible for its own permission check
 * before calling this.
 */
export async function softDeleteRow(
  entity: SoftDeleteEntity,
  id: string,
  actorId: string,
  opts: SoftDeleteOptions = {}
): Promise<{ id: string; label: string }> {
  const delegate = (db as unknown as DynamicDelegateMap)[entity.prismaModel];

  const existing = await delegate.findUnique({
    where: { id },
    select: { id: true, deletedAt: true, [entity.labelField]: true },
  });
  if (!existing) {
    throw new Error(`${entity.singularLabel} not found`);
  }
  if (existing.deletedAt) {
    throw new Error(
      `${entity.singularLabel} is already in the recovery bin — restore it from /admin/recovery instead.`
    );
  }

  const updated = await delegate.update({
    where: { id },
    data: { deletedAt: new Date() },
    select: { id: true, [entity.labelField]: true },
  });

  if (opts.log !== false) {
    await logActivity(
      "soft-deleted",
      entity.entityType,
      id,
      actorId,
      String(updated[entity.labelField] ?? existing[entity.labelField] ?? ""),
      opts.scope ?? {}
    );
  }

  return {
    id,
    label: String(existing[entity.labelField] ?? ""),
  };
}

/**
 * Generic restore: clear deletedAt on the row. The row reappears in
 * every list view it was filtered out of.
 */
export async function restoreRow(
  entity: SoftDeleteEntity,
  id: string,
  actorId: string
): Promise<{ id: string; label: string }> {
  const delegate = (db as unknown as DynamicDelegateMap)[entity.prismaModel];

  const existing = await delegate.findUnique({
    where: { id },
    select: { id: true, deletedAt: true, [entity.labelField]: true },
  });
  if (!existing) {
    throw new Error(`${entity.singularLabel} not found`);
  }
  if (!existing.deletedAt) {
    throw new Error(
      `${entity.singularLabel} isn't in the recovery bin (already restored?).`
    );
  }

  await delegate.update({
    where: { id },
    data: { deletedAt: null },
  });

  await logActivity(
    "restored",
    entity.entityType,
    id,
    actorId,
    String(existing[entity.labelField] ?? "")
  );

  return { id, label: String(existing[entity.labelField] ?? "") };
}

/**
 * Generic permanent-delete: drops the row immediately. The recovery
 * UI calls this for "Delete forever"; the cron calls it for rows
 * past their retention window.
 *
 * No "row already gone" error — caller may be racing the cron, and
 * a clean no-op is friendlier than a thrown error.
 */
export async function hardDeleteRow(
  entity: SoftDeleteEntity,
  id: string,
  actorId: string | null
): Promise<{ deleted: boolean }> {
  const delegate = (db as unknown as DynamicDelegateMap)[entity.prismaModel];

  const existing = await delegate.findUnique({
    where: { id },
    select: { id: true, [entity.labelField]: true },
  });
  if (!existing) return { deleted: false };

  await delegate.delete({ where: { id } });

  if (actorId) {
    await logActivity(
      "permanently-deleted",
      entity.entityType,
      id,
      actorId,
      String(existing[entity.labelField] ?? "")
    );
  }
  return { deleted: true };
}

/**
 * Bulk-purge: hard-delete every soft-deleted row across every
 * registered entity whose deletedAt is older than the cutoff. Used by
 * the PURGE_SOFT_DELETED scheduled task. Returns per-entity counts so
 * the task's "last run output" can summarize.
 */
export async function purgeOldSoftDeletes(
  retentionDays = DEFAULT_RETENTION_DAYS
): Promise<{ entity: string; purged: number }[]> {
  const cutoff = purgeCutoff(retentionDays);
  const summary: { entity: string; purged: number }[] = [];
  for (const entity of SOFT_DELETE_ENTITIES) {
    const delegate = (db as unknown as DynamicDelegateMap)[entity.prismaModel];
    const result = await delegate.deleteMany({
      where: { deletedAt: { lt: cutoff } },
    });
    summary.push({ entity: entity.entityType, purged: result.count });
  }
  return summary;
}
