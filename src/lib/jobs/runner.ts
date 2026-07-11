/**
 * Job runner — executes a registered job and records the run in JobLog.
 *
 * Used by both the cron endpoint (`POST /api/jobs/run`) and the admin
 * "Run now" button. The runner is the single place that knows how to
 * start/finish/error a job — handlers themselves just return JobResult.
 */

import { db } from "@/lib/db";
import { log } from "@/lib/log";
import { notify } from "@/lib/notifications";
import { absoluteUrl } from "@/lib/url";
import type { JobContext, JobResult } from "./types";
import { getJob, listJobs } from "./registry";

/** Consecutive failures that trip the admin alert. */
const FAILURE_ALERT_STREAK = 3;

/**
 * Alert admins when a job hits exactly FAILURE_ALERT_STREAK consecutive
 * failed runs — once per streak, not on every subsequent failure (the
 * streak resets on any completed run). Failures used to just accumulate
 * silently in /admin/jobs history; a broken cron job could sit dead for
 * weeks. Best-effort: alerting must never mask the original failure.
 */
async function maybeAlertJobFailing(jobKey: string, jobName: string, error: string) {
  try {
    const recent = await db.jobLog.findMany({
      where: { jobKey, status: { in: ["completed", "failed"] } },
      orderBy: { startedAt: "desc" },
      take: FAILURE_ALERT_STREAK + 1,
      select: { status: true },
    });
    const streak = recent.slice(0, FAILURE_ALERT_STREAK);
    const prior = recent[FAILURE_ALERT_STREAK];
    const atThreshold =
      streak.length === FAILURE_ALERT_STREAK &&
      streak.every((r) => r.status === "failed") &&
      prior?.status !== "failed";
    if (!atThreshold) return;

    const admins = await db.user.findMany({
      where: { isActive: true, role: "ADMIN" },
      select: { id: true },
    });
    if (admins.length === 0) return;
    await notify({
      recipientId: admins.map((a) => a.id),
      type: "job-failing",
      title: `Scheduled job failing: ${jobName}`,
      body: `${FAILURE_ALERT_STREAK} consecutive runs have failed. Latest error: ${error.slice(0, 200)}`,
      href: `/admin/jobs/${jobKey}`,
      entityType: "job",
      entityId: jobKey,
      email: {
        templateKey: "notification",
        data: {
          recipientName: "Admin",
          heading: `Scheduled job failing: ${jobName}`,
          body: `The "${jobName}" job has failed ${FAILURE_ALERT_STREAK} runs in a row. It will keep retrying on schedule, but something needs attention. Latest error: ${error.slice(0, 300)}`,
          cta: { label: "Open job history", url: absoluteUrl(`/admin/jobs/${jobKey}`) },
        },
      },
    });
  } catch (err) {
    log.error("jobs.failureAlert", "Failed to send job-failing alert", err, { jobKey });
  }
}

/**
 * Run a single job by key. Records start/finish in JobLog. Returns the
 * JobLog row id and the result.
 *
 * Concurrency guard: if the same job is already running (status="running"
 * within the last hour), this returns a "skipped" result instead of
 * starting a duplicate. Override with `force: true` for the manual
 * admin-trigger button if needed.
 */
export async function runJob(
  jobKey: string,
  triggeredBy: string,
  options: { force?: boolean; dryRun?: boolean } = {}
): Promise<{
  status: "completed" | "failed" | "skipped" | "unknown" | "disabled";
  output?: string;
  error?: string;
  processed?: number;
  logId?: string;
}> {
  const job = getJob(jobKey);
  if (!job) {
    return { status: "unknown", error: `No job registered with key "${jobKey}"` };
  }

  // Dry runs only for handlers that declare support — a handler that
  // ignores ctx.dryRun would execute for real under a "preview" label.
  if (options.dryRun && !job.supportsDryRun) {
    return {
      status: "failed",
      error: `Job "${jobKey}" doesn't support dry-run preview yet.`,
    };
  }

  // Skip disabled jobs unless the caller is force-running (the admin
  // "Run now" button in the UI passes force:true so toggling a job off
  // doesn't lock out manual testing). Dry runs also bypass the toggle —
  // previewing a paused job is exactly when you want to see what it
  // WOULD do.
  if (!options.force && !options.dryRun) {
    const config = await db.jobConfig.findUnique({ where: { jobKey } });
    if (config && !config.isEnabled) {
      return {
        status: "disabled",
        output: `Job "${jobKey}" is disabled — re-enable it from /admin/jobs to resume scheduled runs.`,
      };
    }
  }

  // Concurrency check — don't double-run. Dry runs write nothing, so
  // they can't conflict with a live run and skip the guard.
  if (!options.force && !options.dryRun) {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

    // Reap abandoned "running" rows older than an hour. The previous
    // worker crashed mid-job (OOM / container kill / hard deploy) and
    // never updated the row to "failed". The 1h window is wide enough
    // to never collide with a still-live worker but tight enough that
    // the admin Jobs page reflects reality within an hour of any crash.
    const reaped = await db.jobLog.updateMany({
      where: {
        jobKey,
        status: "running",
        startedAt: { lt: oneHourAgo },
      },
      data: {
        status: "failed",
        finishedAt: new Date(),
        error: "Abandoned: worker did not finish within 1h, presumed crashed",
      },
    });
    if (reaped.count > 0) {
      log.warn("jobs.runner", "Reaped abandoned running rows", {
        jobKey,
        count: reaped.count,
      });
    }

    const inProgress = await db.jobLog.findFirst({
      where: {
        jobKey,
        status: "running",
        startedAt: { gte: oneHourAgo },
      },
      orderBy: { startedAt: "desc" },
    });
    if (inProgress) {
      return {
        status: "skipped",
        output: `Job is already running (started ${inProgress.startedAt.toISOString()})`,
      };
    }
  }

  // Insert the running row first so concurrent invocations see it
  const startedAt = new Date();
  const logRow = await db.jobLog.create({
    data: {
      jobKey,
      status: "running",
      startedAt,
      triggeredBy,
    },
  });

  const ctx: JobContext = { triggeredAt: startedAt, triggeredBy, dryRun: options.dryRun };

  try {
    const result: JobResult = await job.handler(ctx);
    const finishedAt = new Date();
    const durationMs = finishedAt.getTime() - startedAt.getTime();
    // Handlers may opt to record a "skipped" row by returning
    // { status: "skipped" } — used by cadence gates so the admin Jobs
    // page reflects "we evaluated this and chose not to run" instead
    // of leaving no row behind. A skipped run does NOT count toward
    // the cadence gate (see lib/jobs/gating.ts). Dry runs are recorded
    // as "skipped" for the same reason: a preview must never satisfy
    // (and thereby suppress) the day's real run.
    const finalStatus: "completed" | "skipped" =
      options.dryRun || result.status === "skipped" ? "skipped" : "completed";
    const output = options.dryRun
      ? `DRY RUN — nothing was sent or written.\n${result.output ?? ""}`.trimEnd()
      : result.output || null;
    await db.jobLog.update({
      where: { id: logRow.id },
      data: {
        status: finalStatus,
        finishedAt,
        durationMs,
        output,
        processed: result.processed ?? null,
      },
    });
    return {
      status: finalStatus,
      output: output ?? undefined,
      processed: result.processed,
      logId: logRow.id,
    };
  } catch (err) {
    const finishedAt = new Date();
    const durationMs = finishedAt.getTime() - startedAt.getTime();
    const errorMessage = err instanceof Error ? `${err.message}\n${err.stack || ""}` : String(err);
    await db.jobLog.update({
      where: { id: logRow.id },
      data: {
        status: "failed",
        finishedAt,
        durationMs,
        error: errorMessage,
      },
    });
    log.error("jobs.runner", "Job handler threw", err, { jobKey });
    // Dry-run failures are experiments, not incidents.
    if (!options.dryRun) {
      await maybeAlertJobFailing(jobKey, job.name, errorMessage);
    }
    return {
      status: "failed",
      error: errorMessage,
      logId: logRow.id,
    };
  }
}

/**
 * Run every registered job sequentially. Used by the cron endpoint when
 * called without a specific job key. Each job is independent — one
 * failure doesn't stop the others.
 */
export async function runAllJobs(triggeredBy: string) {
  const results: Record<string, Awaited<ReturnType<typeof runJob>>> = {};
  for (const job of listJobs()) {
    results[job.key] = await runJob(job.key, triggeredBy);
  }
  return results;
}
