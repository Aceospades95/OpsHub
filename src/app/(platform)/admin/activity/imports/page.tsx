import Link from "next/link";
import { redirect } from "next/navigation";
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  FileSpreadsheet,
} from "lucide-react";
import { format } from "date-fns";
import type { ImportLog, Prisma } from "@prisma/client";

import { requireAuth } from "@/lib/permissions";
import { db } from "@/lib/db";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";

const PAGE_SIZE = 50;

interface SearchParams {
  importer?: string;
  cursor?: string;
  dir?: string;
}

/**
 * `failed` was only stored explicitly from 2026-07 on; legacy rows have
 * the column default (0) and must fall back to the arithmetic
 * derivation. New rows satisfy rowCount = imported + updated + skipped
 * + failed, so the derivation matches the stored value for them too.
 */
function failedCountFor(log: ImportLog): number {
  return log.failed > 0
    ? log.failed
    : Math.max(0, log.rowCount - log.imported - log.updated - log.skipped);
}

/**
 * Cursor pagination over ImportLog, newest first. Same composite
 * (createdAt, id) cursor pattern as /admin/activity — `cursor` is the
 * id of the boundary row, `dir` chooses which side of it to load.
 */
async function loadPage(
  where: Prisma.ImportLogWhereInput,
  cursor: string | undefined,
  dir: string | undefined
): Promise<{ logs: ImportLog[]; hasNext: boolean; hasPrev: boolean }> {
  if (!cursor) {
    const logs = await db.importLog.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: PAGE_SIZE + 1,
    });
    return {
      logs: logs.slice(0, PAGE_SIZE),
      hasNext: logs.length > PAGE_SIZE,
      hasPrev: false,
    };
  }

  const cursorRow = await db.importLog.findUnique({
    where: { id: cursor },
    select: { createdAt: true, id: true },
  });
  if (!cursorRow) {
    // Stale or invalid cursor — fall back to the first page.
    return loadPage(where, undefined, undefined);
  }

  const olderThanCursor: Prisma.ImportLogWhereInput = {
    OR: [
      { createdAt: { lt: cursorRow.createdAt } },
      { AND: [{ createdAt: cursorRow.createdAt }, { id: { lt: cursorRow.id } }] },
    ],
  };
  const newerThanCursor: Prisma.ImportLogWhereInput = {
    OR: [
      { createdAt: { gt: cursorRow.createdAt } },
      { AND: [{ createdAt: cursorRow.createdAt }, { id: { gt: cursorRow.id } }] },
    ],
  };

  if (dir === "prev") {
    const logs = await db.importLog.findMany({
      where: { AND: [where, newerThanCursor] },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: PAGE_SIZE + 1,
    });
    return {
      logs: logs.slice(0, PAGE_SIZE).reverse(),
      hasNext: true,
      hasPrev: logs.length > PAGE_SIZE,
    };
  }

  // Default direction: forward (older runs).
  const logs = await db.importLog.findMany({
    where: { AND: [where, olderThanCursor] },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: PAGE_SIZE + 1,
  });
  return {
    logs: logs.slice(0, PAGE_SIZE),
    hasNext: logs.length > PAGE_SIZE,
    hasPrev: true,
  };
}

function toQueryString(params: { [key: string]: string | undefined }): string {
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v) usp.set(k, v);
  }
  return usp.toString();
}

/**
 * Admin → Activity → Imports.
 *
 * Surfaces the ImportLog rows the importer wizard writes on every
 * commit. Each row shows the importer key, file name, counts (created
 * / updated / skipped / failed / warnings), the user who triggered it,
 * and a timestamp. Clicking a row drills into the full row-level
 * results JSON for diagnosis.
 */
export const metadata = { title: "Import History · OpsHub" };

export default async function ImportActivityPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const user = await requireAuth();
  if (user.role !== "ADMIN") redirect("/dashboard");

  const importerFilter = searchParams.importer?.trim() || undefined;
  const where: Prisma.ImportLogWhereInput = importerFilter
    ? { importerKey: importerFilter }
    : {};

  const [pageResult, total, importerKeys, users] = await Promise.all([
    loadPage(where, searchParams.cursor?.trim() || undefined, searchParams.dir),
    db.importLog.count({ where }),
    db.importLog
      .findMany({ select: { importerKey: true }, distinct: ["importerKey"] })
      .then((rows) => rows.map((r) => r.importerKey).sort()),
    db.user.findMany({ select: { id: true, name: true } }),
  ]);
  const { logs, hasNext, hasPrev } = pageResult;

  const userById = new Map(users.map((u) => [u.id, u.name] as const));

  const filterParams = { importer: importerFilter };
  const olderHref =
    hasNext && logs.length > 0
      ? `/admin/activity/imports?${toQueryString({
          ...filterParams,
          cursor: logs[logs.length - 1].id,
          dir: "next",
        })}`
      : null;
  const newerHref =
    hasPrev && logs.length > 0
      ? `/admin/activity/imports?${toQueryString({
          ...filterParams,
          cursor: logs[0].id,
          dir: "prev",
        })}`
      : null;

  return (
    <div>
      <Link
        href="/admin/activity"
        className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground mb-4"
      >
        <ArrowLeft className="h-3 w-3" />
        Back to Activity Log
      </Link>

      <PageHeader
        title="Import history"
        description={`Every CSV import run is recorded here. Showing ${logs.length} of ${total}, ${PAGE_SIZE} per page.`}
      />

      {importerKeys.length > 0 && (
        <Card className="mb-4">
          <CardContent className="p-3 flex flex-wrap items-center gap-2 text-sm">
            <span className="text-muted-foreground">Filter by importer:</span>
            <Link
              href="/admin/activity/imports"
              className={`rounded-full px-3 py-1 text-xs transition-colors ${
                !importerFilter
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted hover:bg-muted/70"
              }`}
            >
              All
            </Link>
            {importerKeys.map((key) => (
              <Link
                key={key}
                href={`/admin/activity/imports?importer=${encodeURIComponent(key)}`}
                className={`rounded-full px-3 py-1 text-xs transition-colors ${
                  importerFilter === key
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted hover:bg-muted/70"
                }`}
              >
                {key}
              </Link>
            ))}
          </CardContent>
        </Card>
      )}

      {logs.length === 0 ? (
        <EmptyState
          icon={FileSpreadsheet}
          title="No imports yet"
          description={
            importerFilter
              ? `No imports for "${importerFilter}". Clear the filter to see other runs.`
              : "Run an import from /admin/import — it'll show up here."
          }
        />
      ) : (
        <Card className="overflow-hidden">
          <CardContent className="p-0">
            <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/30 border-b border-border">
                <tr className="text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                  <th className="px-4 py-2 font-semibold">When</th>
                  <th className="px-4 py-2 font-semibold">Importer</th>
                  <th className="px-4 py-2 font-semibold">File</th>
                  <th className="px-4 py-2 font-semibold">Triggered by</th>
                  <th className="px-4 py-2 font-semibold text-right">Created</th>
                  <th className="px-4 py-2 font-semibold text-right">Updated</th>
                  <th className="px-4 py-2 font-semibold text-right">Skipped</th>
                  <th className="px-4 py-2 font-semibold text-right">Failed</th>
                  <th className="px-4 py-2 font-semibold text-right">Warnings</th>
                  <th className="px-4 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log) => {
                  const failedCount = failedCountFor(log);
                  return (
                    <tr
                      key={log.id}
                      className="border-b border-border/40 last:border-b-0 hover:bg-muted/20"
                    >
                      <td className="px-4 py-2 whitespace-nowrap text-xs text-muted-foreground">
                        {format(log.createdAt, "MMM d, yyyy 'at' h:mm a")}
                      </td>
                      <td className="px-4 py-2">
                        <Badge variant="outline" className="text-[10px]">
                          {log.importerKey}
                        </Badge>
                      </td>
                      <td
                        className="px-4 py-2 truncate max-w-[200px] font-mono text-xs"
                        title={log.filename}
                      >
                        {log.filename}
                      </td>
                      <td className="px-4 py-2 text-xs">
                        {userById.get(log.triggeredBy) ?? log.triggeredBy}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums text-success font-medium">
                        {log.imported}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums text-blue-600 font-medium">
                        {log.updated}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums text-warning">
                        {log.skipped}
                      </td>
                      <td
                        className={`px-4 py-2 text-right tabular-nums ${
                          failedCount > 0 ? "text-destructive font-medium" : ""
                        }`}
                      >
                        {failedCount}
                      </td>
                      <td
                        className={`px-4 py-2 text-right tabular-nums ${
                          log.warnings > 0 ? "text-amber-600 font-medium" : ""
                        }`}
                      >
                        {log.warnings}
                      </td>
                      <td className="px-4 py-2 text-right">
                        <Link
                          href={`/admin/activity/imports/${log.id}`}
                          className="inline-flex items-center text-xs text-primary hover:underline"
                        >
                          Details
                          <ChevronRight className="h-3 w-3" />
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            </div>
          </CardContent>
        </Card>
      )}

      {(newerHref || olderHref) && (
        <div className="flex items-center justify-between mt-4 text-sm">
          {newerHref ? (
            <Link
              href={newerHref}
              className="inline-flex items-center gap-1 rounded border border-border px-3 py-1.5 hover:bg-muted/30"
            >
              <ChevronLeft className="h-4 w-4" />
              Newer
            </Link>
          ) : (
            <span />
          )}
          {olderHref ? (
            <Link
              href={olderHref}
              className="inline-flex items-center gap-1 rounded border border-border px-3 py-1.5 hover:bg-muted/30"
            >
              Older
              <ChevronRight className="h-4 w-4" />
            </Link>
          ) : (
            <span />
          )}
        </div>
      )}
    </div>
  );
}
