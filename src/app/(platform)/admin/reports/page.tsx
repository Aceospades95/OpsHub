import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { format } from "date-fns";

import { db } from "@/lib/db";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { BarChart3, ArrowRight, Plus } from "lucide-react";
import { listReports } from "@/lib/reports";
import { ENTITY_REGISTRY } from "@/lib/reports/custom/entities";

export default async function AdminReportsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (session.user.role !== "ADMIN") redirect("/dashboard");

  const reports = listReports();
  const byModule = reports.reduce<Record<string, typeof reports>>((acc, r) => {
    (acc[r.module] = acc[r.module] || []).push(r);
    return acc;
  }, {});
  const modules = Object.keys(byModule).sort();

  const customReports = await db.customReport.findMany({
    orderBy: [{ isActive: "desc" }, { name: "asc" }],
    include: { createdBy: { select: { id: true, name: true } } },
  });

  return (
    <div>
      <PageHeader
        title="Reports"
        description="Run saved reports, preview results, download CSVs, and email digests."
        actions={
          <Link href="/admin/reports/custom/new">
            <Button>
              <Plus className="h-4 w-4 mr-2" />
              New custom report
            </Button>
          </Link>
        }
      />

      <Card className="mb-6">
        <CardContent className="py-4 flex items-center gap-3">
          <BarChart3 className="h-5 w-5 text-muted-foreground" />
          <div className="flex-1">
            <p className="text-sm">
              {reports.length} system report
              {reports.length === 1 ? "" : "s"} across {modules.length} module
              {modules.length === 1 ? "" : "s"} ·{" "}
              {customReports.length} custom report
              {customReports.length === 1 ? "" : "s"}.
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              System reports are code-defined and read-only. Custom reports
              let you compose your own from the schema — pick an entity,
              choose columns and filters, save, and email on a schedule via{" "}
              <Link
                href="/admin/scheduled-tasks"
                className="text-primary hover:underline"
              >
                Scheduled Tasks
              </Link>
              .
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Custom reports — listed first because they're the user's own. */}
      {customReports.length > 0 && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Custom reports</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {customReports.map((r) => (
                <Link
                  key={r.id}
                  href={`/admin/reports/custom/${r.id}/edit`}
                  className="flex items-center gap-3 rounded border border-border p-3 hover:border-primary hover:bg-muted/40 transition-colors"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-semibold">{r.name}</p>
                      <Badge variant="outline" className="text-[10px]">
                        {ENTITY_REGISTRY[r.entityType].label}
                      </Badge>
                      {!r.isActive && (
                        <Badge variant="secondary" className="text-[10px]">
                          inactive
                        </Badge>
                      )}
                    </div>
                    {r.description && (
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {r.description}
                      </p>
                    )}
                    <p className="text-[10px] text-muted-foreground mt-1">
                      Created by {r.createdBy.name} ·{" "}
                      {format(r.createdAt, "MMM d, yyyy")}
                    </p>
                  </div>
                  <ArrowRight className="h-4 w-4 text-muted-foreground" />
                </Link>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {modules.map((mod) => (
        <Card key={mod} className="mb-4">
          <CardHeader>
            <CardTitle className="capitalize">{mod} reports</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {byModule[mod].map((r) => (
                <Link
                  key={r.key}
                  href={`/admin/reports/${r.key}`}
                  className="flex items-center gap-3 rounded border border-border p-3 hover:border-primary hover:bg-muted/40 transition-colors"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-semibold">{r.name}</p>
                      <Badge variant="outline" className="text-[10px] font-mono">
                        {r.key}
                      </Badge>
                      {r.schedulable !== false && (
                        <Badge variant="outline" className="text-[10px]">
                          schedulable
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {r.description}
                    </p>
                  </div>
                  <ArrowRight className="h-4 w-4 text-muted-foreground" />
                </Link>
              ))}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
