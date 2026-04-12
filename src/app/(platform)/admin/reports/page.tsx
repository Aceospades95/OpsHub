import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { BarChart3, ArrowRight } from "lucide-react";
import { listReports } from "@/lib/reports";

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

  return (
    <div>
      <PageHeader
        title="Reports"
        description="Run saved reports, preview results, download CSVs, and email digests."
      />

      <Card className="mb-6">
        <CardContent className="py-4 flex items-center gap-3">
          <BarChart3 className="h-5 w-5 text-muted-foreground" />
          <div className="flex-1">
            <p className="text-sm">
              {reports.length} registered report
              {reports.length === 1 ? "" : "s"} across {modules.length} module
              {modules.length === 1 ? "" : "s"}.
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              Reports are read-only. Each run reads live data — nothing is
              cached. Email delivery uses the <code>report</code> template
              and logs every send to the email log.
            </p>
          </div>
        </CardContent>
      </Card>

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
