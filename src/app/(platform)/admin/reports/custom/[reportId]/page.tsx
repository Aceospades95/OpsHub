import { requireAuth } from "@/lib/permissions";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Pencil } from "lucide-react";

import { db } from "@/lib/db";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ReportRunner } from "../../[key]/report-runner";

interface Props {
  params: Promise<{ reportId: string }>;
}

export default async function CustomReportViewPage({ params }: Props) {
  const { reportId } = await params;
  const user = await requireAuth();
  if (user.role !== "ADMIN") redirect("/dashboard");

  const report = await db.customReport.findUnique({
    where: { id: reportId },
  });
  if (!report) notFound();

  // Same recipient picker the system reports use. Pre-fetched so the
  // first render isn't empty.
  const recipients = await db.user.findMany({
    where: { isActive: true, hasLoginAccess: true },
    select: { id: true, name: true, email: true },
    orderBy: { name: "asc" },
  });

  return (
    <div>
      <Link
        href="/admin/reports"
        className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground mb-4"
      >
        <ArrowLeft className="h-3 w-3" />
        Back to reports
      </Link>
      <PageHeader
        title={report.name}
        description={report.description ?? "Custom report"}
        actions={
          <div className="flex items-center gap-2">
            <Badge variant="outline">custom</Badge>
            <Link href={`/admin/reports/custom/${report.id}/edit`}>
              <Button variant="outline">
                <Pencil className="h-4 w-4 mr-2" />
                Edit
              </Button>
            </Link>
          </div>
        }
      />
      <ReportRunner
        // The runner accepts a key; for custom reports we pass the
        // `custom:{id}` form so runReportAction / emailReportAction
        // route to the custom-report runtime.
        reportKey={`custom:${report.id}`}
        reportName={report.name}
        recipients={recipients}
      />
    </div>
  );
}
