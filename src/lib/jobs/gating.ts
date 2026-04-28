/**
 * Cadence-based gating helpers for scheduled jobs.
 *
 * Why this exists: the cron Lambda invokes `/api/jobs/run` every hour
 * (the smallest cadence anything in the registry needs — workflows-tick
 * and custom-scheduled-tasks both run hourly). The runner doesn't
 * interpret the `schedule` string on a JobDefinition, so without
 * per-job gating every "Daily" / "Weekly" job would also fire every
 * hour. For most jobs that's just wasted work; for daily-reports-digest
 * it sends an email each tick, which is the bug that motivated this
 * helper.
 *
 * Design choices:
 *   - We gate by reading JobLog history rather than scheduling state on
 *     the JobDefinition. The DB is the source of truth across container
 *     restarts; an in-memory cadence wouldn't survive a deploy.
 *   - Only "completed" runs count toward the gate. A previous "failed"
 *     run SHOULD be retried on the next tick — letting failures block
 *     subsequent attempts would leave a broken job stuck for a full
 *     cadence window. "skipped" rows also don't count, so a chain of
 *     skips can't accidentally delay the next real attempt.
 *   - Windows are slightly under the nominal cadence (23h / 6d / 28d
 *     instead of 24h / 7d / 30d) so a job that runs at 06:00 on Monday
 *     also runs at 06:00 on Tuesday even if the second invocation
 *     arrives a few seconds early.
 */

import { db } from "@/lib/db";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

async function lastCompletedAt(jobKey: string): Promise<Date | null> {
  const row = await db.jobLog.findFirst({
    where: { jobKey, status: "completed" },
    orderBy: { startedAt: "desc" },
    select: { startedAt: true },
  });
  return row?.startedAt ?? null;
}

/**
 * True when the job has not completed in the last 23 hours, so a
 * daily-cadence job called this tick should run.
 */
export async function shouldRunDaily(jobKey: string): Promise<boolean> {
  const last = await lastCompletedAt(jobKey);
  if (!last) return true;
  return Date.now() - last.getTime() >= 23 * HOUR_MS;
}

/**
 * True when the job has not completed in the last 6 days.
 */
export async function shouldRunWeekly(jobKey: string): Promise<boolean> {
  const last = await lastCompletedAt(jobKey);
  if (!last) return true;
  return Date.now() - last.getTime() >= 6 * DAY_MS;
}

/**
 * True when the job has not completed in the last 28 days. 28 (not 30)
 * keeps the cadence stable for monthly jobs that anchor to a specific
 * day-of-month — see ScheduledTask.dayOfMonth for the same reasoning.
 */
export async function shouldRunMonthly(jobKey: string): Promise<boolean> {
  const last = await lastCompletedAt(jobKey);
  if (!last) return true;
  return Date.now() - last.getTime() >= 28 * DAY_MS;
}
