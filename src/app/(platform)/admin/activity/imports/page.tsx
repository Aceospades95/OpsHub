import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, ChevronRight, FileSpreadsheet } from "lucide-react";
import { format } from "date-fns";

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
}

/**
 * Admin → Activity → Imports.
 *
 * Surfaces the ImportLog rows the importer wizard already writes on
 * every commit. Each row shows the importer key, file name, counts
 * (created / updated / skipped / failed), the user who triggered it,
 * and a timestamp. Clicking a row drills into the full row-level
 * results JSON for diagnosis.
 *
 * The QA spec asked for "stored CSV + mapping + row-level results for
 * ≥30 days" — the mapping isn't tracked today (only counts + the
 * errors blob). That tracking is a follow-up; this page is the
 * surfacing layer for what we DO have, plus a hook for the richer
 * data when it lands.
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

  const [logs, total, importerKeys, users] = await Promise.all([
    db.importLog.findMany({
      where: importerFilter ? { importerKey: importerFilter } : {},
      orderBy: { createdAt: "desc" },
      take: PAGE_SIZE,
    }),
    db.importLog.count({
      where: importerFilter ? { importerKey: importerFilter } : {},
    }),
    db.importLog
      .findMany({ select: { importerKey: true }, distinct: ["importerKey"] })
      .then((rows) => rows.map((r) => r.importerKey).sort()),
    db.user.findMany({ select: { id: true, name: true } }),
  ]);

  const userById = new Map(users.map((u) => [u.id, u.name] as const));

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
        description={`Every CSV import run is recorded here. Showing the most recent ${PAGE_SIZE} of ${total}.`}
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
                  <th className="px-4 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log) => {
                  const failedCount =
                    log.rowCount - log.imported - log.updated - log.skipped;
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
                      <td className="px-4 py-2 text-right tabular-nums text-emerald-600 font-medium">
                        {log.imported}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums text-blue-600 font-medium">
                        {log.updated}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums text-amber-600">
                        {log.skipped}
                      </td>
                      <td
                        className={`px-4 py-2 text-right tabular-nums ${
                          failedCount > 0 ? "text-destructive font-medium" : ""
                        }`}
                      >
                        {failedCount}
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
    </div>
  );
}
