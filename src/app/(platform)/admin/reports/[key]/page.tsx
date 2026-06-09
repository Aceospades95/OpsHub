import { requireAuth } from "@/lib/permissions";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { PageHeader } from "@/components/layout/page-header";
import { db } from "@/lib/db";
import { getReport } from "@/lib/reports";
import { ReportRunner } from "./report-runner";

export default async function AdminReportDetailPage({
  params,
}: {
  params: Promise<{ key: string }>;
}) {
  const user = await requireAuth();
  if (user.role !== "ADMIN") redirect("/dashboard");

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
      {/* Round-7 QA: the inline "Back to reports" link was the
       *  only navigation breadcrumb on this page, so users who
       *  wanted to jump back to Settings had to hop through the
       *  Reports list. Render an explicit two-step breadcrumb
       *  (Settings › Reports › <name>) so both backstops are one
       *  click away. The layout's SettingsNav still renders above
       *  this; keeping the breadcrumb makes the hierarchy obvious
       *  even when SettingsNav is small / easy to miss. */}
      <nav
        aria-label="Breadcrumb"
        className="flex items-center gap-1.5 text-xs text-muted-foreground mb-4"
      >
        <Link href="/admin" className="hover:text-foreground">
          Settings
        </Link>
        <span aria-hidden className="opacity-40">›</span>
        <Link href="/admin/reports" className="hover:text-foreground">
          Reports
        </Link>
        <span aria-hidden className="opacity-40">›</span>
        <span className="text-foreground" title={report.name}>
          {report.name.length > 40 ? `${report.name.slice(0, 40)}…` : report.name}
        </span>
      </nav>
      <PageHeader title={report.name} description={report.description} />
      <ReportRunner
        reportKey={report.key}
        reportName={report.name}
        recipients={recipients}
      />
    </div>
  );
}
