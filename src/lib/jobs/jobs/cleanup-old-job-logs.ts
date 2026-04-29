/**
 * cleanup-old-job-logs
 *
 * Deletes JobLog rows older than the retention window. JobLog grows
 * fast — workflows-tick alone writes one row per minute, so a year of
 * unmanaged retention is ~525k rows. The default 90-day window keeps
 * it bounded while still letting an admin diagnose recent failures
 * from the /admin/jobs page.
 *
 * Override the window with JOB_LOG_RETENTION_DAYS in env.
 *
 * Run weekly via cron. Idempotent — running multiple times in a row
 * is safe (the second run finds zero rows). The (startedAt) index
 * covers the WHERE clause.
 *
 * Note: this job's own row is subject to the same retention. After 90
 * days a successful "cleanup-old-job-logs" entry deletes itself. The
 * cleanup never deletes an in-flight ("running") row regardless of
 * age — runner.ts handles abandoned-row reaping at job start.
 */

import { db } from "@/lib/db";
import { shouldRunWeekly } from "../gating";
import type { JobDefinition } from "../types";

const DEFAULT_RETENTION_DAYS = 90;

export const cleanupOldJobLogs: JobDefinition = {
  key: "cleanup-old-job-logs",
  name: "Cleanup old job logs",
  description:
    "Deletes JobLog rows older than the retention window (default 90 days; override with JOB_LOG_RETENTION_DAYS).",
  schedule: "Weekly",

  async handler() {
    if (!(await shouldRunWeekly("cleanup-old-job-logs"))) {
      return { status: "skipped", output: "Already ran this week", processed: 0 };
    }
    const retentionDaysRaw = process.env.JOB_LOG_RETENTION_DAYS;
    const retentionDays = retentionDaysRaw
      ? Number.parseInt(retentionDaysRaw, 10)
      : DEFAULT_RETENTION_DAYS;
    const days =
      Number.isFinite(retentionDays) && retentionDays > 0
        ? retentionDays
        : DEFAULT_RETENTION_DAYS;

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);

    // Don't delete in-flight ("running") rows even if they're old —
    // runner.ts reaps abandoned ones at job start. A delete here
    // could race with that reap and lose the failure record.
    const result = await db.jobLog.deleteMany({
      where: {
        startedAt: { lt: cutoff },
        status: { not: "running" },
      },
    });

    return {
      output: `Deleted ${result.count} job log row${result.count === 1 ? "" : "s"} older than ${days} days`,
      processed: result.count,
    };
  },
};
