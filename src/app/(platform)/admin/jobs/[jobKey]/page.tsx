import { requireAuth } from "@/lib/permissions";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  CheckCircle2,
  AlertCircle,
  PlayCircle,
  Clock,
} from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";

import { db } from "@/lib/db";
import { getJob } from "@/lib/jobs";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { JobRunButton } from "../job-run-button";
import { JobToggleButton } from "../job-toggle-button";

interface Props {
  params: Promise<{ jobKey: string }>;
}

export default async function JobDetailPage({ params }: Props) {
  const { jobKey } = await params;
  const user = await requireAuth();
  if (user.role !== "ADMIN") redirect("/dashboard");

  const job = getJob(jobKey);
  if (!job) notFound();

  const [config, runs, totals] = await Promise.all([
    db.jobConfig.findUnique({ where: { jobKey } }),
    db.jobLog.findMany({
      where: { jobKey },
      orderBy: { startedAt: "desc" },
      take: 100,
    }),
    db.jobLog.groupBy({
      by: ["status"],
      where: { jobKey },
      _count: { _all: true },
    }),
  ]);

  const isEnabled = config?.isEnabled ?? true;
  const completedTotal = totals.find((t) => t.status === "completed")?._count._all ?? 0;
  const failedTotal = totals.find((t) => t.status === "failed")?._count._all ?? 0;
  const runningTotal = totals.find((t) => t.status === "running")?._count._all ?? 0;

  return (
    <div>
      <Link
        href="/admin/jobs"
        className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground mb-4"
      >
        <ArrowLeft className="h-3 w-3" />
        Back to jobs
      </Link>
      <PageHeader
        title={job.name}
        description={job.description}
        actions={
          <div className="flex items-center gap-2">
            <JobToggleButton jobKey={job.key} isEnabled={isEnabled} />
            <JobRunButton jobKey={job.key} />
          </div>
        }
      />

      <Card className="mb-6">
        <CardContent className="py-4 grid grid-cols-2 md:grid-cols-4 gap-4">
          <Stat label="Schedule" value={job.schedule} />
          <Stat label="Status" value={isEnabled ? "Enabled" : "Paused"} />
          <Stat
            label="Completed"
            value={completedTotal.toLocaleString()}
            valueClass="text-emerald-600"
          />
          <Stat
            label="Failed"
            value={failedTotal.toLocaleString()}
            valueClass={failedTotal > 0 ? "text-destructive" : ""}
          />
        </CardContent>
      </Card>

      {!isEnabled && (
        <div className="mb-6 rounded border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-xs text-amber-700">
          This job is paused. Cron will skip it until you re-enable it. You can
          still trigger it manually with <strong>Run now</strong>; that bypasses
          the pause for one-off testing.
        </div>
      )}

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Recent runs (last 100)</CardTitle>
            {runningTotal > 0 && (
              <Badge variant="outline" className="text-[10px]">
                {runningTotal} currently running
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {runs.length === 0 ? (
            <div className="py-8 text-center text-muted-foreground">
              <Clock className="h-12 w-12 mx-auto mb-3 opacity-40" />
              <p className="text-sm">No runs yet for this job.</p>
              <p className="text-xs mt-2">
                Click <strong>Run now</strong> above to fire it manually.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {runs.map((log) => (
                <div
                  key={log.id}
                  className="flex items-start gap-3 rounded border border-border p-3"
                >
                  {log.status === "completed" ? (
                    <CheckCircle2 className="h-4 w-4 text-emerald-600 mt-0.5 shrink-0" />
                  ) : log.status === "failed" ? (
                    <AlertCircle className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
                  ) : (
                    <PlayCircle className="h-4 w-4 text-blue-600 mt-0.5 shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge variant="outline" className="text-[10px]">
                        {log.status}
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        {log.triggeredBy === "cron" ? "cron" : "manual"}
                      </span>
                      {log.durationMs !== null && (
                        <span className="text-xs text-muted-foreground">
                          {log.durationMs}ms
                        </span>
                      )}
                      {log.processed !== null && (
                        <span className="text-xs text-muted-foreground">
                          {log.processed} processed
                        </span>
                      )}
                    </div>
                    {log.output && (
                      <p className="text-xs text-muted-foreground mt-1">
                        {log.output}
                      </p>
                    )}
                    {log.error && (
                      <pre className="mt-1 text-[10px] text-destructive font-mono whitespace-pre-wrap break-all bg-destructive/5 rounded p-2 max-h-48 overflow-auto">
                        {log.error}
                      </pre>
                    )}
                  </div>
                  <div
                    className="text-xs text-muted-foreground text-right shrink-0"
                    title={format(log.startedAt, "yyyy-MM-dd HH:mm:ss")}
                  >
                    {formatDistanceToNow(log.startedAt, { addSuffix: true })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({
  label,
  value,
  valueClass = "",
}: {
  label: string;
  value: string;
  valueClass?: string;
}) {
  return (
    <div>
      <p className={`text-lg font-semibold ${valueClass}`}>{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}
