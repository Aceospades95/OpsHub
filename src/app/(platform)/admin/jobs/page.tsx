import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { db } from "@/lib/db";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Clock,
  CheckCircle2,
  AlertCircle,
  PlayCircle,
  Repeat,
  ChevronRight,
} from "lucide-react";
import { formatDistanceToNow, format } from "date-fns";
import { listJobs } from "@/lib/jobs";
import { JobRunButton } from "./job-run-button";
import { JobToggleButton } from "./job-toggle-button";
import { JobCadenceSelect } from "./job-cadence-select";

export default async function AdminJobsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (session.user.role !== "ADMIN") redirect("/dashboard");

  const jobs = listJobs();
  const jobKeys = jobs.map((j) => j.key);

  // Pull the most recent run for each job + the last 50 across all jobs
  // + the JobConfig rows so we can render enabled/disabled state.
  const [recentRunsByJob, recentLogs, totals, configs] = await Promise.all([
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
    db.jobConfig.findMany({
      where: { jobKey: { in: jobKeys } },
    }),
  ]);

  const enabledByKey = new Map(configs.map((c) => [c.jobKey, c.isEnabled]));
  const cadenceByKey = new Map(configs.map((c) => [c.jobKey, c.cadence ?? ""]));

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
        <CardContent className="py-4 flex items-start gap-3">
          <Repeat className="h-5 w-5 text-muted-foreground mt-0.5" />
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
              <details className="mt-1">
                <summary className="text-xs text-destructive cursor-pointer">
                  <code>CRON_SECRET</code> is missing — scheduled runs are paused.
                  Click for setup steps.
                </summary>
                <ol className="mt-2 ml-4 list-decimal text-xs text-muted-foreground space-y-1">
                  <li>
                    Generate a strong random string (e.g.{" "}
                    <code>openssl rand -hex 32</code>).
                  </li>
                  <li>
                    Add <code>CRON_SECRET=&lt;that string&gt;</code> to your env
                    (Vercel project settings, <code>.env</code>, or your
                    deployment platform).
                  </li>
                  <li>
                    Restart the app so the env var is picked up.
                  </li>
                  <li>
                    Configure a scheduler to POST{" "}
                    <code>/api/jobs/run</code> on whatever cadence you want
                    (hourly is a sensible default), passing the same secret in
                    the <code>x-cron-secret</code> header. Examples:
                    <ul className="ml-4 mt-1 list-disc">
                      <li>
                        <strong>Vercel Cron</strong>: add an entry to{" "}
                        <code>vercel.json</code> &mdash; Vercel injects the
                        header automatically when the value matches the env.
                      </li>
                      <li>
                        <strong>GitHub Actions</strong>: a scheduled workflow
                        with a <code>curl</code> call passing the secret from a
                        repo secret.
                      </li>
                      <li>
                        <strong>OS cron / Cloudflare</strong>: any tool that can
                        send an HTTP POST with a header.
                      </li>
                    </ul>
                  </li>
                </ol>
                <p className="mt-2 text-xs text-muted-foreground">
                  You can still trigger jobs manually with the{" "}
                  <strong>Run now</strong> button while the secret is missing.
                </p>
              </details>
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

      {/* System-vs-custom explainer — long enough to deserve its own
           card so first-time admins know where to look for what. */}
      <Card className="mb-6 border-dashed">
        <CardContent className="py-4 text-sm">
          <p className="font-medium mb-1">
            What is this page, and what&apos;s the difference vs Scheduled
            Tasks?
          </p>
          <p className="text-muted-foreground text-xs leading-relaxed">
            <strong>Scheduled Jobs</strong> (this page) are{" "}
            <em>system jobs</em> — code-defined background work that ships
            with OpsHub. They handle things like cleanup, expiry checks,
            workflow ticking, and the runner that fires custom tasks. The
            registry lives in <code>src/lib/jobs/registry.ts</code>; new
            jobs are added by a developer there, not from the UI. Admins
            can <strong>open</strong> a job to see its run history,{" "}
            <strong>enable / disable</strong> it (paused jobs are skipped
            by cron but can still be force-run from <strong>Run now</strong>
            ), and delete logs.
          </p>
          <p className="text-muted-foreground text-xs leading-relaxed mt-2">
            <strong>
              <Link
                href="/admin/scheduled-tasks"
                className="text-primary hover:underline"
              >
                Scheduled Tasks
              </Link>
            </strong>{" "}
            (separate page) are <em>admin-built</em> recurring tasks. Use
            those to email a report on a schedule, broadcast a message,
            etc. — those <strong>can</strong> be created and edited
            entirely from the UI. The <code>custom-scheduled-tasks</code>{" "}
            job below is the cron entry that fires those tasks; if you
            disable it, your scheduled tasks will stop firing.
          </p>
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
              const isEnabled = enabledByKey.get(job.key) ?? true;
              const cadenceOverride = cadenceByKey.get(job.key) ?? "";
              return (
                <div
                  key={job.key}
                  className={`flex items-start gap-3 rounded border p-3 transition-colors ${
                    isEnabled
                      ? "border-border hover:border-primary/50"
                      : "border-border bg-muted/30"
                  }`}
                >
                  <Link
                    href={`/admin/jobs/${job.key}`}
                    className="flex-1 min-w-0 group"
                  >
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-semibold group-hover:underline">
                        {job.name}
                      </p>
                      <Badge variant="outline" className="text-[10px] font-mono">
                        {job.key}
                      </Badge>
                      <Badge variant="outline" className="text-[10px]">
                        {job.schedule}
                      </Badge>
                      {cadenceOverride && (
                        <Badge variant="default" className="text-[10px]">
                          override: {cadenceOverride.toLowerCase()}
                        </Badge>
                      )}
                      {!isEnabled && (
                        <Badge variant="secondary" className="text-[10px]">
                          paused
                        </Badge>
                      )}
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
                  </Link>
                  <div className="flex items-center gap-2 shrink-0">
                    <JobCadenceSelect jobKey={job.key} current={cadenceOverride} />
                    <JobToggleButton jobKey={job.key} isEnabled={isEnabled} />
                    <JobRunButton jobKey={job.key} />
                    <Link
                      href={`/admin/jobs/${job.key}`}
                      className="text-muted-foreground hover:text-foreground"
                      aria-label="Open job details"
                    >
                      <ChevronRight className="h-4 w-4" />
                    </Link>
                  </div>
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
