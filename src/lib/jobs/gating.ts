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

/**
 * Cadence labels admins can pick from in /admin/jobs. The string set
 * matches what's stored in JobConfig.cadence.
 */
export const CADENCE_OVERRIDES = [
  "HOURLY",
  "DAILY",
  "WEEKLY",
  "MONTHLY",
  "DISABLED",
] as const;
export type CadenceOverride = (typeof CADENCE_OVERRIDES)[number];

async function lastCompletedAt(jobKey: string): Promise<Date | null> {
  const row = await db.jobLog.findFirst({
    where: { jobKey, status: "completed" },
    orderBy: { startedAt: "desc" },
    select: { startedAt: true },
  });
  return row?.startedAt ?? null;
}

/**
 * Resolve the active cadence for a job. Returns the override from
 * JobConfig when set; otherwise the caller-supplied default (the
 * code-defined cadence baked into the handler).
 */
async function resolveCadence(
  jobKey: string,
  fallback: CadenceOverride
): Promise<CadenceOverride> {
  try {
    const row = await db.jobConfig.findUnique({
      where: { jobKey },
      select: { cadence: true },
    });
    const override = row?.cadence as CadenceOverride | null | undefined;
    if (override && (CADENCE_OVERRIDES as readonly string[]).includes(override)) {
      return override;
    }
  } catch {
    // Fall through — JobConfig fetch failure shouldn't lock out the
    // gate. The fallback is the same value we'd have used pre-override.
  }
  return fallback;
}

function windowMsFor(cadence: CadenceOverride): number | null {
  // Slightly under the nominal cadence so a job that runs at 06:00 on
  // Monday also runs at 06:00 on Tuesday even if the second invocation
  // arrives a few seconds early. Mirrors the original constants.
  if (cadence === "HOURLY") return 55 * 60 * 1000; // 55 min
  if (cadence === "DAILY") return 23 * HOUR_MS;
  if (cadence === "WEEKLY") return 6 * DAY_MS;
  if (cadence === "MONTHLY") return 28 * DAY_MS;
  return null; // DISABLED
}

/**
 * Generic gate driven by the resolved cadence. Returns false when the
 * cadence is DISABLED, or when a completed run lands inside the
 * cadence window. Used by the named helpers below; can also be called
 * directly when the cadence is dynamic (e.g. a job that picks its
 * cadence at runtime).
 */
async function shouldRunCadence(
  jobKey: string,
  fallback: CadenceOverride
): Promise<boolean> {
  const cadence = await resolveCadence(jobKey, fallback);
  if (cadence === "DISABLED") return false;
  const windowMs = windowMsFor(cadence);
  if (windowMs == null) return false;
  const last = await lastCompletedAt(jobKey);
  if (!last) return true;
  return Date.now() - last.getTime() >= windowMs;
}

/**
 * True when the job has not completed in the last 23 hours, so a
 * daily-cadence job called this tick should run. Honors a JobConfig
 * cadence override.
 */
export async function shouldRunDaily(jobKey: string): Promise<boolean> {
  return shouldRunCadence(jobKey, "DAILY");
}

/**
 * True when the job has not completed in the last 6 days. Honors a
 * JobConfig cadence override.
 */
export async function shouldRunWeekly(jobKey: string): Promise<boolean> {
  return shouldRunCadence(jobKey, "WEEKLY");
}

/**
 * True when the job has not completed in the last 28 days. 28 (not 30)
 * keeps the cadence stable for monthly jobs that anchor to a specific
 * day-of-month — see ScheduledTask.dayOfMonth for the same reasoning.
 * Honors a JobConfig cadence override.
 */
export async function shouldRunMonthly(jobKey: string): Promise<boolean> {
  return shouldRunCadence(jobKey, "MONTHLY");
}

/**
 * Hourly gate. Most jobs that want hourly cadence don't bother with a
 * gate (the cron driver fires hourly and they run every tick), but a
 * daily/weekly job whose admin tightened it to HOURLY via the override
 * routes through here.
 */
export async function shouldRunHourly(jobKey: string): Promise<boolean> {
  return shouldRunCadence(jobKey, "HOURLY");
}

/**
 * Gate for jobs whose NATURAL cadence is "every cron tick" (the engine
 * tick runs per-minute, google-tasks-sync per 5 minutes — driven by
 * dedicated cron entries, see docs/deployment.md). With no JobConfig
 * override this returns true unconditionally so the dedicated cadence
 * is untouched; when an admin sets an override, it becomes real
 * (previously the override dropdown displayed for these jobs but
 * changed nothing — audit finding #5).
 */
export async function shouldRunTick(jobKey: string): Promise<boolean> {
  try {
    const row = await db.jobConfig.findUnique({
      where: { jobKey },
      select: { cadence: true },
    });
    const override = row?.cadence as CadenceOverride | null | undefined;
    if (!override || !(CADENCE_OVERRIDES as readonly string[]).includes(override)) {
      return true;
    }
    if (override === "DISABLED") return false;
    const windowMs = windowMsFor(override);
    if (windowMs == null) return false;
    const last = await lastCompletedAt(jobKey);
    if (!last) return true;
    return Date.now() - last.getTime() >= windowMs;
  } catch {
    return true;
  }
}
