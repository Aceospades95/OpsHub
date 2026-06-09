import { requireAuth } from "@/lib/permissions";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import type { Prisma } from "@prisma/client";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";
import { Download } from "lucide-react";
import Link from "next/link";

const PAGE_SIZE = 50;

// Render the entityId column. CUIDs (`c…25-char alphanum`) are too
// long to scan at full width, so we keep them at an 8-char prefix.
// Anything that isn't CUID-shaped — job keys like
// "contract-expiry-check", workflow slugs, etc. — is shown in full
// because slicing those at 8 chars makes them ambiguous (the QA
// repro: "job · contract-expiry-check" was rendered as "job ·
// contract" since the first 8 chars happened to land on a hyphen).
const CUID_PATTERN = /^c[a-z0-9]{24}$/;
function shortEntityId(id: string): string {
  return CUID_PATTERN.test(id) ? id.slice(0, 8) : id;
}

/**
 * Resolve every (entityType, entityId) pair on this page of activity
 * log rows to its display name in a small fixed number of queries.
 * Returns a Map keyed on `${entityType}:${entityId}` → { name,
 * deleted } so the renderer can show e.g. `task · "Phase 1 Delivery"`
 * instead of `task · cmotl71c`.
 *
 * Round-7 QA: the entityId column previously rendered the raw cuid
 * (after the round-4 mid-word-truncation fix). Useful for forensics
 * but unscanable when you're just trying to read the audit trail.
 * Resolved names land here; the cuid moves to a hover title on
 * the rendered span so it's still copy-pasteable.
 *
 * Soft-deleted rows are still resolved (they have a `deletedAt` but
 * the row is intact) and flagged so the cell can render a "(deleted)"
 * note alongside. Hard-deleted rows fall through to the cuid as
 * before.
 */
type EntityLabel = { name: string; deleted: boolean };
async function resolveEntityLabels(
  rows: { entityType: string; entityId: string }[]
): Promise<Map<string, EntityLabel>> {
  // Bucket ids by entityType so each model is queried at most once.
  const byType = new Map<string, Set<string>>();
  for (const r of rows) {
    if (!CUID_PATTERN.test(r.entityId)) continue; // job keys etc.
    if (!byType.has(r.entityType)) byType.set(r.entityType, new Set());
    byType.get(r.entityType)!.add(r.entityId);
  }
  if (byType.size === 0) return new Map();

  const out = new Map<string, EntityLabel>();
  function record(type: string, id: string, name: string, deleted: boolean) {
    out.set(`${type}:${id}`, { name, deleted });
  }

  // Each lookup goes parallel; an unknown entityType just produces
  // no entries (renderer falls back to the cuid prefix).
  const tasks: Promise<unknown>[] = [];

  const grab = (type: string) => Array.from(byType.get(type) ?? []);

  if (byType.has("project")) {
    const ids = grab("project");
    tasks.push(
      db.project
        .findMany({ where: { id: { in: ids } }, select: { id: true, name: true, deletedAt: true } })
        .then((rs) => rs.forEach((r) => record("project", r.id, r.name, r.deletedAt !== null)))
    );
  }
  if (byType.has("client")) {
    const ids = grab("client");
    tasks.push(
      db.client
        .findMany({ where: { id: { in: ids } }, select: { id: true, name: true, deletedAt: true } })
        .then((rs) => rs.forEach((r) => record("client", r.id, r.name, r.deletedAt !== null)))
    );
  }
  if (byType.has("task")) {
    const ids = grab("task");
    tasks.push(
      db.task
        .findMany({ where: { id: { in: ids } }, select: { id: true, title: true, deletedAt: true } })
        .then((rs) => rs.forEach((r) => record("task", r.id, r.title, r.deletedAt !== null)))
    );
  }
  if (byType.has("supplier")) {
    const ids = grab("supplier");
    tasks.push(
      db.supplier
        .findMany({ where: { id: { in: ids } }, select: { id: true, name: true, deletedAt: true } })
        .then((rs) => rs.forEach((r) => record("supplier", r.id, r.name, r.deletedAt !== null)))
    );
  }
  if (byType.has("subcontractor")) {
    const ids = grab("subcontractor");
    tasks.push(
      db.subcontractor
        .findMany({ where: { id: { in: ids } }, select: { id: true, name: true, deletedAt: true } })
        .then((rs) => rs.forEach((r) => record("subcontractor", r.id, r.name, r.deletedAt !== null)))
    );
  }
  if (byType.has("partnership")) {
    const ids = grab("partnership");
    tasks.push(
      db.partnership
        .findMany({ where: { id: { in: ids } }, select: { id: true, name: true, deletedAt: true } })
        .then((rs) => rs.forEach((r) => record("partnership", r.id, r.name, r.deletedAt !== null)))
    );
  }
  if (byType.has("contract")) {
    const ids = grab("contract");
    tasks.push(
      db.contract
        .findMany({ where: { id: { in: ids } }, select: { id: true, title: true, deletedAt: true } })
        .then((rs) => rs.forEach((r) => record("contract", r.id, r.title, r.deletedAt !== null)))
    );
  }
  if (byType.has("certification")) {
    const ids = grab("certification");
    tasks.push(
      db.certification
        .findMany({ where: { id: { in: ids } }, select: { id: true, name: true, deletedAt: true } })
        .then((rs) => rs.forEach((r) => record("certification", r.id, r.name, r.deletedAt !== null)))
    );
  }
  if (byType.has("tool")) {
    const ids = grab("tool");
    tasks.push(
      db.tool
        .findMany({ where: { id: { in: ids } }, select: { id: true, name: true, deletedAt: true } })
        .then((rs) => rs.forEach((r) => record("tool", r.id, r.name, r.deletedAt !== null)))
    );
  }
  if (byType.has("user")) {
    const ids = grab("user");
    tasks.push(
      db.user
        .findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })
        .then((rs) => rs.forEach((r) => record("user", r.id, r.name, false)))
    );
  }
  if (byType.has("quote")) {
    const ids = grab("quote");
    tasks.push(
      db.quote
        .findMany({ where: { id: { in: ids } }, select: { id: true, title: true, quoteNumber: true, deletedAt: true } })
        .then((rs) => rs.forEach((r) => record("quote", r.id, r.title || r.quoteNumber, r.deletedAt !== null)))
    );
  }

  await Promise.all(tasks);
  return out;
}

interface SearchParams {
  actor?: string;
  entityType?: string;
  projectId?: string;
  clientId?: string;
  from?: string;
  to?: string;
  cursor?: string;
  dir?: string;
  [key: string]: string | undefined;
}

export const metadata = { title: "Activity Log · OpsHub" };

export default async function AdminActivityPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const user = await requireAuth();
  if (user.role !== "ADMIN") redirect("/dashboard");

  const where = buildWhere(searchParams);

  const [pageResult, total, users, projects, clients, entityTypes] = await Promise.all([
    loadPage(where, PAGE_SIZE, searchParams.cursor, searchParams.dir),
    db.activityLog.count({ where }),
    db.user.findMany({
      where: { activityLogs: { some: {} } },
      select: { id: true, name: true, email: true },
      orderBy: { name: "asc" },
    }),
    db.project.findMany({
      where: { deletedAt: null },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    db.client.findMany({
      where: { deletedAt: null },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    db.activityLog.findMany({
      distinct: ["entityType"],
      select: { entityType: true },
      orderBy: { entityType: "asc" },
    }),
  ]);

  const { rows, hasNext, hasPrev } = pageResult;
  const entityLabels = await resolveEntityLabels(
    rows.map((r) => ({ entityType: r.entityType, entityId: r.entityId }))
  );

  // Page-position calculation for the "Page X of Y" indicator. Keyset
  // pagination doesn't have a native page number, so we derive it from
  // the position of the first visible row: count how many rows are
  // newer-than-or-equal-to it under the same filter, then divide by
  // page size and round up. The composite (createdAt, id) index covers
  // this so it's cheap.
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const currentPage =
    rows.length === 0
      ? 1
      : Math.max(
          1,
          Math.ceil(
            (await db.activityLog.count({
              where: {
                AND: [
                  where,
                  {
                    OR: [
                      { createdAt: { gt: rows[0].createdAt } },
                      {
                        AND: [
                          { createdAt: rows[0].createdAt },
                          { id: { gte: rows[0].id } },
                        ],
                      },
                    ],
                  },
                ],
              },
            })) / PAGE_SIZE
          )
        );

  const filterParams = stripPaginationParams(searchParams);
  const csvHref = `/api/admin/activity/csv?${toQueryString(filterParams)}`;
  const newestHref = `/admin/activity?${toQueryString(filterParams)}`;
  const olderHref =
    hasNext && rows.length > 0
      ? `/admin/activity?${toQueryString({
          ...filterParams,
          cursor: rows[rows.length - 1].id,
          dir: "next",
        })}`
      : null;
  const newerHref =
    hasPrev && rows.length > 0
      ? `/admin/activity?${toQueryString({
          ...filterParams,
          cursor: rows[0].id,
          dir: "prev",
        })}`
      : null;

  return (
    <div>
      <PageHeader
        title="Activity Log"
        description="Every create, update, and delete recorded across the platform"
        actions={
          <Link
            href={csvHref}
            className="inline-flex items-center gap-1 rounded-md border border-border px-3 py-1.5 text-sm hover:bg-muted/30"
          >
            <Download className="h-4 w-4" />
            Export CSV
          </Link>
        }
      />

      <Card className="mb-4">
        <CardContent className="p-4">
          <form
            method="get"
            action="/admin/activity"
            className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-6 gap-3 items-end"
          >
            <Field label="Actor">
              <select name="actor" defaultValue={searchParams.actor || ""} className={selectCls}>
                <option value="">Anyone</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Entity type">
              <select
                name="entityType"
                defaultValue={searchParams.entityType || ""}
                className={selectCls}
              >
                <option value="">Any</option>
                {entityTypes.map((e) => (
                  <option key={e.entityType} value={e.entityType}>
                    {e.entityType}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Project">
              <select
                name="projectId"
                defaultValue={searchParams.projectId || ""}
                className={selectCls}
              >
                <option value="">Any</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Client">
              <select
                name="clientId"
                defaultValue={searchParams.clientId || ""}
                className={selectCls}
              >
                <option value="">Any</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="From">
              <input
                type="date"
                name="from"
                defaultValue={searchParams.from || ""}
                className={selectCls}
              />
            </Field>
            <Field label="To">
              <input
                type="date"
                name="to"
                defaultValue={searchParams.to || ""}
                className={selectCls}
              />
            </Field>
            <div className="lg:col-span-6 flex items-center gap-2">
              <button
                type="submit"
                className="inline-flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90"
              >
                Apply filters
              </button>
              <Link
                href="/admin/activity"
                className="inline-flex items-center gap-1 rounded-md border border-border px-3 py-1.5 text-sm hover:bg-muted/30"
              >
                Clear
              </Link>
              <span className="ml-auto text-xs text-muted-foreground">
                {total.toLocaleString()} {total === 1 ? "entry" : "entries"} match
                {total > 0 && ` · page ${currentPage.toLocaleString()} of ${totalPages.toLocaleString()}`}
              </span>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0 overflow-x-auto">
          {rows.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">
              No activity matches these filters.
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-xs text-muted-foreground">
                <tr>
                  <th className="text-left px-3 py-2 font-medium">When</th>
                  <th className="text-left px-3 py-2 font-medium">Actor</th>
                  <th className="text-left px-3 py-2 font-medium">Action</th>
                  <th className="text-left px-3 py-2 font-medium">Entity</th>
                  <th className="text-left px-3 py-2 font-medium">Project</th>
                  <th className="text-left px-3 py-2 font-medium">Client</th>
                  <th className="text-left px-3 py-2 font-medium">Details</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="border-t border-border">
                    <td className="px-3 py-2 whitespace-nowrap text-xs text-muted-foreground">
                      {format(row.createdAt, "yyyy-MM-dd HH:mm")}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">{row.user?.name || "—"}</td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <Badge variant="outline" className="text-[10px] font-mono">
                        {row.action}
                      </Badge>
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap text-xs">
                      <span className="font-mono text-muted-foreground">{row.entityType}</span>
                      <span className="text-muted-foreground/60"> · </span>
                      {(() => {
                        const label = entityLabels.get(`${row.entityType}:${row.entityId}`);
                        if (label) {
                          return (
                            <span title={row.entityId}>
                              &ldquo;{label.name}&rdquo;
                              {label.deleted && (
                                <span className="ml-1 text-[10px] text-muted-foreground/70">
                                  (deleted)
                                </span>
                              )}
                            </span>
                          );
                        }
                        return (
                          <span className="font-mono text-[11px]" title={row.entityId}>
                            {shortEntityId(row.entityId)}
                          </span>
                        );
                      })()}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {row.project ? (
                        <Link href={`/projects/${row.project.id}`} className="hover:underline">
                          {row.project.name}
                        </Link>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {row.client ? (
                        <Link href={`/clients/${row.client.id}`} className="hover:underline">
                          {row.client.name}
                        </Link>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground max-w-md truncate">
                      {row.details || ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      {(newerHref || olderHref) && (
        <div className="mt-4 flex items-center justify-between text-sm">
          <div className="flex gap-2">
            {searchParams.cursor && (
              <Link
                href={newestHref}
                className="rounded border border-border px-3 py-1 hover:bg-muted/30"
              >
                ⇤ Newest
              </Link>
            )}
            {newerHref && (
              <Link
                href={newerHref}
                className="rounded border border-border px-3 py-1 hover:bg-muted/30"
              >
                ← Newer
              </Link>
            )}
          </div>
          <div>
            {olderHref && (
              <Link
                href={olderHref}
                className="rounded border border-border px-3 py-1 hover:bg-muted/30"
              >
                Older →
              </Link>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs text-muted-foreground mb-1">{label}</span>
      {children}
    </label>
  );
}

const selectCls =
  "w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary";

function buildWhere(params: SearchParams): Prisma.ActivityLogWhereInput {
  const where: Prisma.ActivityLogWhereInput = {};
  if (params.actor) where.userId = params.actor;
  if (params.entityType) where.entityType = params.entityType;
  if (params.projectId) where.projectId = params.projectId;
  if (params.clientId) where.clientId = params.clientId;
  if (params.from || params.to) {
    const range: { gte?: Date; lte?: Date } = {};
    if (params.from) range.gte = new Date(params.from);
    if (params.to) {
      const end = new Date(params.to);
      end.setUTCHours(23, 59, 59, 999);
      range.lte = end;
    }
    where.createdAt = range;
  }
  return where;
}

const includeForRow = {
  user: { select: { id: true, name: true, email: true } },
  project: { select: { id: true, name: true } },
  client: { select: { id: true, name: true } },
} as const;

type ActivityRow = Prisma.ActivityLogGetPayload<{ include: typeof includeForRow }>;

/**
 * Keyset (cursor) pagination on the natural sort key (createdAt DESC, id DESC).
 *
 * - First page (no cursor): newest PAGE_SIZE+1 rows. The +1 is dropped before
 *   render and tells us whether an "Older" page exists.
 * - dir=next from cursor X: rows strictly older than X's (createdAt, id) tuple.
 *   We always have a "Newer" link in this case because the cursor row exists.
 * - dir=prev from cursor X: rows strictly newer than X's (createdAt, id) tuple,
 *   queried ASC, then reversed for display. The +1 trick here tells us whether
 *   another "Newer" page exists above this one.
 *
 * The cursor stores only the row's PK; the (createdAt, id) tuple is recovered
 * by an indexed point lookup, which is much smaller than embedding both values
 * in the URL.
 */
async function loadPage(
  where: Prisma.ActivityLogWhereInput,
  pageSize: number,
  cursor: string | undefined,
  dir: string | undefined
): Promise<{ rows: ActivityRow[]; hasNext: boolean; hasPrev: boolean }> {
  if (!cursor) {
    const rows = await db.activityLog.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: pageSize + 1,
      include: includeForRow,
    });
    return {
      rows: rows.slice(0, pageSize),
      hasNext: rows.length > pageSize,
      hasPrev: false,
    };
  }

  const cursorRow = await db.activityLog.findUnique({
    where: { id: cursor },
    select: { createdAt: true, id: true },
  });
  if (!cursorRow) {
    // Stale or invalid cursor — fall back to the first page.
    return loadPage(where, pageSize, undefined, undefined);
  }

  const olderThanCursor: Prisma.ActivityLogWhereInput = {
    OR: [
      { createdAt: { lt: cursorRow.createdAt } },
      { AND: [{ createdAt: cursorRow.createdAt }, { id: { lt: cursorRow.id } }] },
    ],
  };
  const newerThanCursor: Prisma.ActivityLogWhereInput = {
    OR: [
      { createdAt: { gt: cursorRow.createdAt } },
      { AND: [{ createdAt: cursorRow.createdAt }, { id: { gt: cursorRow.id } }] },
    ],
  };

  if (dir === "prev") {
    const rows = await db.activityLog.findMany({
      where: { AND: [where, newerThanCursor] },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: pageSize + 1,
      include: includeForRow,
    });
    return {
      rows: rows.slice(0, pageSize).reverse(),
      hasNext: true,
      hasPrev: rows.length > pageSize,
    };
  }

  // Default direction: forward (older).
  const rows = await db.activityLog.findMany({
    where: { AND: [where, olderThanCursor] },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: pageSize + 1,
    include: includeForRow,
  });
  return {
    rows: rows.slice(0, pageSize),
    hasNext: rows.length > pageSize,
    hasPrev: true,
  };
}

function stripPaginationParams(params: SearchParams): SearchParams {
  const { cursor: _c, dir: _d, ...rest } = params;
  return rest;
}

function toQueryString(params: { [key: string]: string | undefined }): string {
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v) usp.set(k, v);
  }
  return usp.toString();
}
