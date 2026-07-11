import { requireAuth } from "@/lib/permissions";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Upload, FileSpreadsheet, CheckCircle2, AlertCircle } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import Link from "next/link";
import { listImporters } from "@/lib/importers";

export const metadata = { title: "Data Import · OpsHub" };

export default async function AdminImportPage() {
  const user = await requireAuth();
  if (user.role !== "ADMIN") redirect("/dashboard");

  const importers = listImporters();

  // Recent runs across all importers
  const recentRuns = await db.importLog.findMany({
    orderBy: { createdAt: "desc" },
    take: 20,
  });

  return (
    <div>
      <PageHeader
        title="Data Import"
        description="Bulk-create records from a CSV file"
      />

      {/* Available importers */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Available Importers ({importers.length})</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {importers.map((imp) => (
              <Link
                key={imp.key}
                href={`/admin/import/${imp.key}`}
                className="block rounded border border-border p-4 hover:bg-muted/30 transition-colors"
              >
                <div className="flex items-center gap-2 mb-2">
                  <FileSpreadsheet className="h-4 w-4 text-muted-foreground" />
                  <p className="text-sm font-semibold">{imp.name}</p>
                  <Badge variant="outline" className="text-[10px] font-mono">
                    {imp.key}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground line-clamp-3">
                  {imp.description}
                </p>
                <p className="text-[10px] text-muted-foreground/70 mt-2">
                  {imp.fields.filter((f) => f.required).length} required ·{" "}
                  {imp.fields.filter((f) => !f.required).length} optional fields
                </p>
              </Link>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Recent runs */}
      <Card>
        <CardHeader>
          <CardTitle>Recent Imports (last 20)</CardTitle>
        </CardHeader>
        <CardContent>
          {recentRuns.length === 0 ? (
            <div className="py-8 text-center text-muted-foreground">
              <Upload className="h-12 w-12 mx-auto mb-3 opacity-40" />
              <p className="text-sm">No imports yet.</p>
              <p className="text-xs mt-2">
                Pick an importer above to upload your first CSV.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {recentRuns.map((run) => {
                // Stored `failed` when present; legacy rows (stored 0)
                // fall back to the arithmetic derivation. A run is only
                // flagged when something actually failed or warned —
                // clean skipped/updated rows are normal upsert traffic,
                // not errors (the old `errors !== null` check made every
                // successful upsert run show a warning icon).
                const failedCount =
                  run.failed > 0
                    ? run.failed
                    : Math.max(
                        0,
                        run.rowCount - run.imported - run.updated - run.skipped
                      );
                const hasIssues = failedCount > 0 || run.warnings > 0;
                return (
                  <div
                    key={run.id}
                    className="flex items-start gap-3 rounded border border-border p-3"
                  >
                    {hasIssues ? (
                      <AlertCircle className="h-4 w-4 text-warning mt-0.5 shrink-0" />
                    ) : (
                      <CheckCircle2 className="h-4 w-4 text-success mt-0.5 shrink-0" />
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="text-[10px] font-mono">
                          {run.importerKey}
                        </Badge>
                        <p className="text-sm font-medium truncate">{run.filename}</p>
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {run.rowCount} rows · {run.imported} imported · {run.updated} updated · {run.skipped} skipped · {failedCount} failed
                        {run.warnings > 0 && ` · ${run.warnings} with warnings`}
                      </p>
                    </div>
                    <div className="text-xs text-muted-foreground text-right shrink-0">
                      {formatDistanceToNow(run.createdAt, { addSuffix: true })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
