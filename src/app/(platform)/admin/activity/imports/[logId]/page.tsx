import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { format } from "date-fns";

import { requireAuth } from "@/lib/permissions";
import { db } from "@/lib/db";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { pluralize } from "@/lib/pluralize";
import { DownloadResultsButton } from "./download-results-button";

interface RowOutcome {
  row: number;
  status: string;
  message?: string;
  warnings?: string[];
}

interface Props {
  params: Promise<{ logId: string }>;
}

/**
 * Drill-down on a single ImportLog. Shows the run summary + every
 * non-clean row from the persisted `errors` JSON blob: failed, skipped,
 * and written-with-warnings rows. Clean imported/updated rows aren't
 * tracked individually — count is enough.
 */
export default async function ImportLogDetailPage({ params }: Props) {
  const user = await requireAuth();
  if (user.role !== "ADMIN") redirect("/dashboard");

  const { logId } = await params;
  const log = await db.importLog.findUnique({ where: { id: logId } });
  if (!log) notFound();

  const triggeredBy = await db.user.findUnique({
    where: { id: log.triggeredBy },
    select: { id: true, name: true, email: true },
  });

  // The errors column stores either null (clean run) or a JSON array
  // of { row, status, message, warnings? } per non-clean row. Parse
  // defensively — a corrupted blob shouldn't crash the page.
  let issueRows: RowOutcome[] = [];
  if (log.errors) {
    try {
      const parsed = JSON.parse(log.errors);
      if (Array.isArray(parsed)) issueRows = parsed as RowOutcome[];
    } catch {
      // Leave issueRows empty + render a degraded notice below.
    }
  }

  // Stored `failed` when present; legacy rows (default 0) derive it.
  const failedCount =
    log.failed > 0
      ? log.failed
      : Math.max(0, log.rowCount - log.imported - log.updated - log.skipped);

  // Order: failures first, then skips, then warning rows.
  const failedRows = issueRows.filter((r) => r.status === "failed");
  const skippedRows = issueRows.filter((r) => r.status === "skipped");
  const warningRows = issueRows.filter(
    (r) => r.status !== "failed" && r.status !== "skipped"
  );
  const orderedRows = [...failedRows, ...skippedRows, ...warningRows];

  return (
    <div>
      <Link
        href="/admin/activity/imports"
        className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground mb-4"
      >
        <ArrowLeft className="h-3 w-3" />
        Back to Import history
      </Link>

      <PageHeader
        title={`Import: ${log.filename}`}
        description={`Run on ${format(log.createdAt, "MMMM d, yyyy 'at' h:mm a")} by ${
          triggeredBy?.name ?? log.triggeredBy
        } via the ${log.importerKey} importer.`}
        actions={
          issueRows.length > 0 ? (
            <DownloadResultsButton
              outcomes={orderedRows}
              filename={`import-${log.importerKey}-${log.id}-row-results.csv`}
            />
          ) : undefined
        }
      />

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
        <SummaryCard label="Total rows" value={log.rowCount} />
        <SummaryCard label="Created" value={log.imported} tone="success" />
        <SummaryCard label="Updated" value={log.updated} tone="info" />
        <SummaryCard label="Skipped" value={log.skipped} tone="warning" />
        <SummaryCard
          label="Failed"
          value={failedCount}
          tone={failedCount > 0 ? "destructive" : undefined}
        />
        <SummaryCard
          label="Warnings"
          value={log.warnings}
          tone={log.warnings > 0 ? "warning" : undefined}
        />
      </div>

      {issueRows.length === 0 ? (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground text-center">
            {log.errors
              ? "Per-row results couldn't be parsed (corrupted JSON blob)."
              : "Clean run — every row imported without issues."}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">
              Issues ({pluralize(issueRows.length, "row")})
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/30 border-y border-border">
                <tr className="text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                  <th className="px-4 py-2 font-semibold w-16">Row</th>
                  <th className="px-4 py-2 font-semibold w-32">Status</th>
                  <th className="px-4 py-2 font-semibold">Message / warnings</th>
                </tr>
              </thead>
              <tbody>
                {orderedRows.map((r) => (
                  <tr
                    key={`${r.row}-${r.status}`}
                    className="border-b border-border/40 last:border-b-0 align-top"
                  >
                    <td className="px-4 py-2 tabular-nums text-xs text-muted-foreground">
                      {r.row}
                    </td>
                    <td className="px-4 py-2">
                      <Badge
                        variant="outline"
                        className={`text-[10px] ${
                          r.status === "failed"
                            ? "text-destructive border-destructive/50"
                            : r.status === "skipped"
                              ? "text-warning border-warning/50"
                              : "text-amber-600 border-amber-600/50"
                        }`}
                      >
                        {r.status === "failed" || r.status === "skipped"
                          ? r.status
                          : `${r.status} with warnings`}
                      </Badge>
                    </td>
                    <td className="px-4 py-2 text-xs text-muted-foreground">
                      {[r.message, ...(r.warnings ?? [])]
                        .filter(Boolean)
                        .join(" · ") || "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function SummaryCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "success" | "info" | "warning" | "destructive";
}) {
  const colorClass =
    tone === "success"
      ? "text-success"
      : tone === "info"
        ? "text-blue-600"
        : tone === "warning"
          ? "text-warning"
          : tone === "destructive"
            ? "text-destructive"
            : "text-foreground";
  return (
    <Card>
      <CardContent className="p-3 text-center">
        <p className={`text-2xl font-bold ${colorClass}`}>{value}</p>
        <p className="text-[10px] text-muted-foreground mt-1 uppercase tracking-wider">
          {label}
        </p>
      </CardContent>
    </Card>
  );
}
