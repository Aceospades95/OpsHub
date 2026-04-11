import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Clock, CheckCircle2, AlertCircle, PlayCircle, Repeat } from "lucide-react";
import { formatDistanceToNow, format } from "date-fns";
import { listJobs } from "@/lib/jobs";
import { JobRunButton } from "./job-run-button";

export default async function AdminJobsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (session.user.role !== "ADMIN") redirect("/dashboard");

  const jobs = listJobs();
  const jobKeys = jobs.map((j) => j.key);

  // Pull the most recent run for each job + the last 50 across all jobs
  const [recentRunsByJob, recentLogs, totals] = await Promise.all([
    db.jobLog.findMany({
      where: { jobKey: { in: jobKeys } },
      orderBy: { startedAt: "desc" },
      // Take more than the job count so we can dedupe to most-recent-per-key
      take: jobKeys.length * 5,
    }),
    db.jobLog.findMany({
      orderBy: { startedAt: "desc" },
      take: 50,
    }),
    db.jobLog.groupBy({
      by: ["status"],
      _count: { _all: true },
    }),
  ]);

  // Build a map of job key → most recent run
  const lastRunByKey = new Map<string, (typeof recentRunsByJob)[number]>();
  for (const run of recentRunsByJob) {
    if (!lastRunByKey.has(run.jobKey)) {
      lastRunByKey.set(run.jobKey, run);
    }
  }

  const completedTotal = totals.find((t) => t.status === "completed")?._count._all ?? 0;
  const failedTotal = totals.find((t) => t.status === "failed")?._count._all ?? 0;
  const runningTotal = totals.find((t) => t.status === "running")?._count._all ?? 0;

  const cronEnabled = !!process.env.CRON_SECRET;

  return (
    <div>
      <PageHeader
        title="Scheduled Jobs"
        description="Recurring tasks that run on a schedule or manually"
      />

      {/* Cron status banner */}
      <Card className="mb-6">
        <CardContent className="py-4 flex items-center gap-3">
          <Repeat className="h-5 w-5 text-muted-foreground" />
          <div className="flex-1">
            <p className="text-sm">
              Cron endpoint:{" "}
              <code className="text-xs">POST /api/jobs/run</code>{" "}
              <Badge variant="outline" className="ml-2">
                {cronEnabled ? "secret configured" : "secret missing"}
              </Badge>
            </p>
            {cronEnabled ? (
              <p className="text-xs text-muted-foreground mt-1">
                Configure your cron provider (Vercel Cron, GitHub Actions, OS cron)
                to POST to this endpoint with the <code>x-cron-secret</code> header.
                Add <code>?job=KEY</code> to run a single job, or no query string
                to run all jobs.
              </p>
            ) : (
              <p className="text-xs text-destructive mt-1">
                Set <code>CRON_SECRET</code> in env to enable scheduled runs.
                You can still run jobs manually below.
              </p>
            )}
          </div>
          <div className="flex gap-4">
            <div className="text-center">
              <p className="text-2xl font-semibold text-emerald-600">{completedTotal}</p>
              <p className="text-xs text-muted-foreground">Completed</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-semibold text-destructive">{failedTotal}</p>
              <p className="text-xs text-muted-foreground">Failed</p>
            </div>
            {runningTotal > 0 && (
              <div className="text-center">
                <p className="text-2xl font-semibold text-blue-600">{runningTotal}</p>
                <p className="text-xs text-muted-foreground">Running</p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Registered jobs */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Registered Jobs ({jobs.length})</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {jobs.map((job) => {
              const lastRun = lastRunByKey.get(job.key);
              return (
                <div
                  key={job.key}
                  className="flex items-start gap-3 rounded border border-border p-3"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-semibold">{job.name}</p>
                      <Badge variant="outline" className="text-[10px] font-mono">
                        {job.key}
                      </Badge>
                      <Badge variant="outline" className="text-[10px]">
                        {job.schedule}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {job.description}
                    </p>
                    {lastRun && (
                      <p className="text-[10px] text-muted-foreground/70 mt-1">
                        Last run:{" "}
                        <span
                          className={
                            lastRun.status === "completed"
                              ? "text-emerald-600"
                              : lastRun.status === "failed"
                                ? "text-destructive"
                                : ""
                          }
                        >
                          {lastRun.status}
                        </span>{" "}
                        {formatDistanceToNow(lastRun.startedAt, { addSuffix: true })}
                        {lastRun.durationMs !== null && (
                          <> · {lastRun.durationMs}ms</>
                        )}
                        {lastRun.processed !== null && (
                          <> · {lastRun.processed} processed</>
                        )}
                      </p>
                    )}
                  </div>
                  <JobRunButton jobKey={job.key} />
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Recent run history */}
      <Card>
        <CardHeader>
          <CardTitle>Recent Runs (last 50)</CardTitle>
        </CardHeader>
        <CardContent>
          {recentLogs.length === 0 ? (
            <div className="py-8 text-center text-muted-foreground">
              <Clock className="h-12 w-12 mx-auto mb-3 opacity-40" />
              <p className="text-sm">No job runs yet.</p>
              <p className="text-xs mt-2">
                Trigger a job above or wait for the cron endpoint to fire.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {recentLogs.map((log) => (
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
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="text-[10px] font-mono">
                        {log.jobKey}
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
                      <p className="text-xs text-destructive mt-1 font-mono break-all line-clamp-3">
                        {log.error}
                      </p>
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
