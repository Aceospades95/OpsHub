import { requireAuth } from "@/lib/permissions";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { Copy, EyeOff } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { db } from "@/lib/db";
import { getReport, getReportOverride } from "@/lib/reports";
import { REPORT_MODULE_TO_ENTITY } from "@/lib/reports/custom/module-map";
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

  // Admin customization (rename/description/hidden) — the header should
  // show what the rest of the app shows, with the stock identity as a
  // subtitle so the underlying report stays recognizable.
  const override = await getReportOverride(key);
  const title = override?.displayName || report.name;
  const description = override?.description || report.description;

  // Reports whose module maps onto a custom-report entity can be
  // "duplicated" — really: start a new custom report on the same table
  // — for admins who want full column/filter control beyond overrides.
  const cloneEntity = REPORT_MODULE_TO_ENTITY[report.module];

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
        <span className="text-foreground" title={title}>
          {title.length > 40 ? `${title.slice(0, 40)}…` : title}
        </span>
      </nav>
      <PageHeader
        title={title}
        description={description}
        actions={
          cloneEntity ? (
            <Link href={`/admin/reports/custom/new?entity=${cloneEntity}`}>
              <Button variant="outline">
                <Copy className="h-4 w-4 mr-2" />
                Duplicate as custom report
              </Button>
            </Link>
          ) : undefined
        }
      />
      {override?.displayName && (
        <p className="text-xs text-muted-foreground -mt-4 mb-4">
          Built-in report: {report.name} ·{" "}
          <code className="font-mono">{key}</code>
        </p>
      )}
      {override?.hidden && (
        <div className="mb-6 rounded border border-warning/30 bg-warning/10 px-4 py-3 text-xs text-warning flex items-start gap-2">
          <EyeOff className="h-4 w-4 shrink-0 mt-0.5" />
          <span>
            This report is <strong>hidden</strong> — it&apos;s excluded from
            the reports list, the scheduled-task picker, and the daily
            digest, and existing scheduled sends skip it with a warning.
            Un-hide it under <strong>Customize this report</strong> below.
          </span>
        </div>
      )}
      <ReportRunner
        reportKey={report.key}
        reportName={title}
        recipients={recipients}
      />
    </div>
  );
}
