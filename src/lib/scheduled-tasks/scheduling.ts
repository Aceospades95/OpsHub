/**
 * Scheduling math for admin-built tasks.
 *
 * The runner fires tasks based on their frequency + hour-of-day +
 * (for weekly) day-of-week + (for monthly) day-of-month. Idempotency
 * is enforced by `lastRunAt`: if the task already fired during the
 * current window we skip it.
 *
 * Window semantics:
 *   HOURLY   — once per UTC hour. Window starts at the top of the hour.
 *   DAILY    — once per UTC day. Window opens at hourUtc.
 *   WEEKLY   — once per (year, week) match on dayOfWeek. Window opens
 *              at hourUtc on the matching day.
 *   MONTHLY  — once per (year, month) match on dayOfMonth. Window opens
 *              at hourUtc on the matching day.
 *
 * All comparisons use UTC so the firing schedule is stable across
 * server timezone changes — admins enter the hour they want and that
 * UTC hour is what fires.
 *
 * Brand-new tasks (lastRunAt === null) only fire when `now` is at-or-
 * past the *current* period's window. We deliberately don't fire
 * stale catch-up runs from periods before the task was created.
 */

import type { ScheduledTaskFrequency } from "@prisma/client";

export interface SchedulingInput {
  frequency: ScheduledTaskFrequency;
  hourUtc: number;
  dayOfWeek: number | null;
  dayOfMonth: number | null;
  lastRunAt: Date | null;
  /** Reference clock — defaults to "now" but injectable for tests. */
  now?: Date;
}

export function isDueNow(input: SchedulingInput): boolean {
  const now = input.now ?? new Date();
  const hour = clampHour(input.hourUtc);

  switch (input.frequency) {
    case "HOURLY": {
      const topOfHour = new Date(
        Date.UTC(
          now.getUTCFullYear(),
          now.getUTCMonth(),
          now.getUTCDate(),
          now.getUTCHours()
        )
      );
      return !input.lastRunAt || input.lastRunAt.getTime() < topOfHour.getTime();
    }

    case "DAILY": {
      const todayAtHour = new Date(
        Date.UTC(
          now.getUTCFullYear(),
          now.getUTCMonth(),
          now.getUTCDate(),
          hour
        )
      );
      if (now.getTime() < todayAtHour.getTime()) return false;
      return (
        !input.lastRunAt ||
        input.lastRunAt.getTime() < todayAtHour.getTime()
      );
    }

    case "WEEKLY": {
      if (input.dayOfWeek == null) return false;
      const target = clampDow(input.dayOfWeek);
      if (now.getUTCDay() !== target) return false;
      const todayAtHour = new Date(
        Date.UTC(
          now.getUTCFullYear(),
          now.getUTCMonth(),
          now.getUTCDate(),
          hour
        )
      );
      if (now.getTime() < todayAtHour.getTime()) return false;
      return (
        !input.lastRunAt ||
        input.lastRunAt.getTime() < todayAtHour.getTime()
      );
    }

    case "MONTHLY": {
      if (input.dayOfMonth == null) return false;
      const target = clampDom(input.dayOfMonth);
      if (now.getUTCDate() !== target) return false;
      const todayAtHour = new Date(
        Date.UTC(
          now.getUTCFullYear(),
          now.getUTCMonth(),
          now.getUTCDate(),
          hour
        )
      );
      if (now.getTime() < todayAtHour.getTime()) return false;
      return (
        !input.lastRunAt ||
        input.lastRunAt.getTime() < todayAtHour.getTime()
      );
    }
  }
}

function clampHour(h: number): number {
  if (!Number.isFinite(h)) return 9;
  return Math.max(0, Math.min(23, Math.floor(h)));
}
function clampDow(d: number): number {
  if (!Number.isFinite(d)) return 1;
  return Math.max(0, Math.min(6, Math.floor(d)));
}
function clampDom(d: number): number {
  if (!Number.isFinite(d)) return 1;
  return Math.max(1, Math.min(28, Math.floor(d)));
}

/** Pretty-print the cadence for the admin UI. */
export function describeCadence(input: {
  frequency: ScheduledTaskFrequency;
  hourUtc: number;
  dayOfWeek: number | null;
  dayOfMonth: number | null;
}): string {
  const hour = clampHour(input.hourUtc);
  const hh = String(hour).padStart(2, "0");
  switch (input.frequency) {
    case "HOURLY":
      return "Every hour";
    case "DAILY":
      return `Every day at ${hh}:00 UTC`;
    case "WEEKLY":
      if (input.dayOfWeek == null) return "Weekly (day not set)";
      return `Every ${DOW_NAMES[clampDow(input.dayOfWeek)]} at ${hh}:00 UTC`;
    case "MONTHLY":
      if (input.dayOfMonth == null) return "Monthly (day not set)";
      return `On day ${clampDom(input.dayOfMonth)} of every month at ${hh}:00 UTC`;
  }
}

const DOW_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];
