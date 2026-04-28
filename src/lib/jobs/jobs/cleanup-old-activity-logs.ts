/**
 * cleanup-old-activity-logs
 *
 * Deletes ActivityLog rows older than the retention window so the table
 * doesn't grow forever. Default retention is 365 days, override with
 * ACTIVITY_LOG_RETENTION_DAYS. Unlike notifications, audit logs of
 * every age are kept — there's no read/unread distinction.
 *
 * Run weekly via cron. Idempotent — running multiple times in a row is
 * safe (the second run finds zero rows). The composite (createdAt)
 * index covers the WHERE clause so the delete plan is range-scan +
 * delete, not a sequential scan.
 *
 * If you need a longer retention window for compliance, raise
 * ACTIVITY_LOG_RETENTION_DAYS or disable the job in /admin/jobs and
 * archive externally before re-enabling.
 */

import { db } from "@/lib/db";
import { shouldRunWeekly } from "../gating";
import type { JobDefinition } from "../types";

const DEFAULT_RETENTION_DAYS = 365;

export const cleanupOldActivityLogs: JobDefinition = {
  key: "cleanup-old-activity-logs",
  name: "Cleanup old activity logs",
  description:
    "Deletes ActivityLog rows older than the retention window (default 365 days; override with ACTIVITY_LOG_RETENTION_DAYS).",
  schedule: "Weekly",

  async handler() {
    if (!(await shouldRunWeekly("cleanup-old-activity-logs"))) {
      return { status: "skipped", output: "Already ran this week", processed: 0 };
    }
    const retentionDaysRaw = process.env.ACTIVITY_LOG_RETENTION_DAYS;
    const retentionDays = retentionDaysRaw
      ? Number.parseInt(retentionDaysRaw, 10)
      : DEFAULT_RETENTION_DAYS;
    const days =
      Number.isFinite(retentionDays) && retentionDays > 0
        ? retentionDays
        : DEFAULT_RETENTION_DAYS;

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);

    const result = await db.activityLog.deleteMany({
      where: { createdAt: { lt: cutoff } },
    });

    return {
      output: `Deleted ${result.count} activity log row${result.count === 1 ? "" : "s"} older than ${days} days`,
      processed: result.count,
    };
  },
};
