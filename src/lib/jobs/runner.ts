/**
 * Job runner — executes a registered job and records the run in JobLog.
 *
 * Used by both the cron endpoint (`POST /api/jobs/run`) and the admin
 * "Run now" button. The runner is the single place that knows how to
 * start/finish/error a job — handlers themselves just return JobResult.
 */

import { db } from "@/lib/db";
import type { JobContext, JobResult } from "./types";
import { getJob, listJobs } from "./registry";

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
  options: { force?: boolean } = {}
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

  // Skip disabled jobs unless the caller is force-running (the admin
  // "Run now" button in the UI passes force:true so toggling a job off
  // doesn't lock out manual testing).
  if (!options.force) {
    const config = await db.jobConfig.findUnique({ where: { jobKey } });
    if (config && !config.isEnabled) {
      return {
        status: "disabled",
        output: `Job "${jobKey}" is disabled — re-enable it from /admin/jobs to resume scheduled runs.`,
      };
    }
  }

  // Concurrency check — don't double-run
  if (!options.force) {
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
      // eslint-disable-next-line no-console
      console.warn(
        `[jobs] reaped ${reaped.count} abandoned "running" row(s) for ${jobKey}`
      );
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

  const ctx: JobContext = { triggeredAt: startedAt, triggeredBy };

  try {
    const result: JobResult = await job.handler(ctx);
    const finishedAt = new Date();
    const durationMs = finishedAt.getTime() - startedAt.getTime();
    // Handlers may opt to record a "skipped" row by returning
    // { status: "skipped" } — used by cadence gates so the admin Jobs
    // page reflects "we evaluated this and chose not to run" instead
    // of leaving no row behind. A skipped run does NOT count toward
    // the cadence gate (see lib/jobs/gating.ts).
    const finalStatus: "completed" | "skipped" =
      result.status === "skipped" ? "skipped" : "completed";
    await db.jobLog.update({
      where: { id: logRow.id },
      data: {
        status: finalStatus,
        finishedAt,
        durationMs,
        output: result.output || null,
        processed: result.processed ?? null,
      },
    });
    return {
      status: finalStatus,
      output: result.output,
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
    // eslint-disable-next-line no-console
    console.error(`[jobs] ${jobKey} failed:`, err);
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
