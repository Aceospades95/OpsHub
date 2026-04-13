import { auth } from "@/lib/auth";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { PageHeader } from "@/components/layout/page-header";
import { db } from "@/lib/db";
import { getReport } from "@/lib/reports";
import { ReportRunner } from "./report-runner";
import { ArrowLeft } from "lucide-react";

export default async function AdminReportDetailPage({
  params,
}: {
  params: Promise<{ key: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (session.user.role !== "ADMIN") redirect("/dashboard");

  const { key } = await params;
  const report = getReport(key);
  if (!report) notFound();

  // Pre-fetch recipient list so the picker doesn't have an empty first render
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
      <PageHeader title={report.name} description={report.description} />
      <ReportRunner
        reportKey={report.key}
        reportName={report.name}
        recipients={recipients}
      />
    </div>
  );
}
