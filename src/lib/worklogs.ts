/**
 * Work-log helpers — pure calendar/roster math for the daily work-log
 * module (lib only; DB access lives in the actions, pages, and the
 * work-log-reminders job).
 *
 * Date discipline
 * ---------------
 * Work dates are CALENDAR dates stored as UTC midnight (see lib/dates).
 * Every function here does its day math in UTC — never local-timezone
 * Date arithmetic — so results are identical on any host TZ. date-fns'
 * ISO-week functions read LOCAL components, so isoWeekKey re-expresses
 * the UTC calendar day as a local date before calling them.
 *
 * Week vocabulary
 * ---------------
 * Weeks are ISO weeks keyed "2026-W28" (zero-padded). `weekBounds`
 * returns the Monday and Sunday of the week as UTC-midnight dates; the
 * week covers both endpoints inclusive, which makes Prisma range
 * filters on UTC-midnight workDate columns exact:
 * `workDate >= start && workDate <= end`.
 */

import { getISOWeek, getISOWeekYear } from "date-fns";

/** Weekly-hours threshold above which a week counts as overtime. */
export const OVERTIME_WEEK_HOURS = 40;

const DAY_MS = 24 * 60 * 60 * 1000;

/** UTC midnight of the value's UTC calendar day. */
export function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

/** Add whole days in UTC. Safe across DST because UTC has none. */
export function addUtcDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}

/**
 * ISO week key ("2026-W28", zero-padded) of a UTC calendar date.
 *
 * date-fns' getISOWeek/getISOWeekYear operate on LOCAL date components,
 * so we hand them a local-midnight date carrying the same Y/M/D as the
 * UTC calendar day. Feeding the raw UTC-midnight instant in would shift
 * the day (and near year boundaries, the whole week-year) on hosts west
 * of UTC.
 */
export function isoWeekKey(date: Date): string {
  const local = new Date(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  const week = getISOWeek(local);
  const year = getISOWeekYear(local);
  return `${year}-W${String(week).padStart(2, "0")}`;
}

const WEEK_KEY_RE = /^(\d{4})-W(\d{2})$/;

/** True when `s` is a well-formed key for a week that exists ("2025-W53" isn't — 2025 has 52 weeks). */
export function isValidWeekKey(s: string | null | undefined): boolean {
  if (!s || !WEEK_KEY_RE.test(s)) return false;
  try {
    weekBounds(s);
    return true;
  } catch {
    return false;
  }
}

/**
 * Monday and Sunday (both UTC midnight) of an ISO week key. The range
 * is inclusive on both ends — see the header comment.
 *
 * Throws on malformed keys and on weeks that don't exist in that ISO
 * year (e.g. "2025-W53"): the start date is round-tripped through
 * isoWeekKey and must land back on the input.
 */
export function weekBounds(weekKey: string): { start: Date; end: Date } {
  const match = WEEK_KEY_RE.exec(weekKey);
  if (!match) throw new Error(`Invalid week key: ${weekKey}`);
  const year = Number(match[1]);
  const week = Number(match[2]);
  if (week < 1 || week > 53) throw new Error(`Invalid week key: ${weekKey}`);

  // ISO week 1 is the week containing Jan 4. Find its Monday, then
  // step forward (week - 1) weeks.
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const jan4Weekday = (jan4.getUTCDay() + 6) % 7; // 0 = Monday
  const week1Monday = addUtcDays(jan4, -jan4Weekday);
  const start = addUtcDays(week1Monday, (week - 1) * 7);

  if (isoWeekKey(start) !== weekKey) {
    throw new Error(`Week does not exist: ${weekKey}`);
  }
  return { start, end: addUtcDays(start, 6) };
}

/** Week key `weeks` ISO weeks away from `weekKey` (negative = earlier). */
export function shiftWeekKey(weekKey: string, weeks: number): string {
  const { start } = weekBounds(weekKey);
  return isoWeekKey(addUtcDays(start, weeks * 7));
}

/**
 * Mon–Fri UTC-midnight dates of the week starting at `weekStart` (a
 * Monday from weekBounds). With `upTo`, only days on or before that
 * date are returned — used for mid-week evaluation ("expected so far").
 * An `upTo` before the Monday yields [].
 */
export function expectedWorkdays(weekStart: Date, opts: { upTo?: Date } = {}): Date[] {
  const cutoff = opts.upTo ? startOfUtcDay(opts.upTo).getTime() : null;
  const days: Date[] = [];
  for (let i = 0; i < 5; i++) {
    const day = addUtcDays(startOfUtcDay(weekStart), i);
    if (cutoff != null && day.getTime() > cutoff) break;
    days.push(day);
  }
  return days;
}

/** A day-range on which logs are not expected (user's own or org-wide). */
export interface ExceptionRange {
  startDate: Date;
  endDate: Date;
}

/**
 * True when `date` falls inside the exception's [startDate, endDate]
 * range — inclusive on BOTH ends, compared by UTC calendar day (a
 * one-day PTO has startDate === endDate).
 */
export function isExceptedDay(date: Date, exceptions: ExceptionRange[]): boolean {
  const day = startOfUtcDay(date).getTime();
  return exceptions.some(
    (e) =>
      startOfUtcDay(e.startDate).getTime() <= day &&
      startOfUtcDay(e.endDate).getTime() >= day
  );
}

/**
 * The expected dates that are neither logged nor covered by an
 * exception. `exceptions` must already be filtered to ranges that
 * apply to this user (their own rows + org-wide rows); date overlap
 * is checked here.
 */
export function missingDays(args: {
  weekDates: Date[];
  logs: { workDate: Date }[];
  exceptions: ExceptionRange[];
}): Date[] {
  const logged = new Set(args.logs.map((l) => startOfUtcDay(l.workDate).getTime()));
  return args.weekDates.filter(
    (d) => !logged.has(startOfUtcDay(d).getTime()) && !isExceptedDay(d, args.exceptions)
  );
}

/**
 * Fields of the User model that decide roster membership. The schema
 * has no employment start-date column, so `startDate` is optional —
 * callers pass User.createdAt (the day the person appeared in OpsHub)
 * so someone added mid-week isn't "missing" for days before they
 * existed; a real hire-date field would slot straight in.
 */
export interface RosterWindowUser {
  isActive: boolean;
  hasLoginAccess: boolean;
  /**
   * OPT-IN enrollment (User.workLogRequired). Nobody owes logs — or
   * hears about missing ones — unless deliberately enrolled. The
   * launch default of "every active user" mass-reminded the whole
   * company on the first cold-start run.
   */
  workLogRequired: boolean;
  /** When enrollment flipped on — days before it are never expected. */
  workLogRequiredSince?: Date | null;
  /** User.terminationDate — LAST day of employment (inclusive). */
  terminationDate?: Date | null;
  /** Earliest day the person counts (compared by UTC calendar day). */
  startDate?: Date | null;
}

/**
 * Does this user count toward the roster for `date`? Fixes the sheet's
 * roster pollution: only ENROLLED people count at all, inactive /
 * no-login / terminated people never get reminded, enrollment mid-week
 * only expects days from the enrollment date on, and a terminationDate
 * mid-week keeps the earlier days expected while releasing the later
 * ones.
 */
export function rosterWindow(user: RosterWindowUser, date: Date): boolean {
  if (!user.workLogRequired) return false;
  if (!user.isActive || !user.hasLoginAccess) return false;
  const day = startOfUtcDay(date).getTime();
  if (user.workLogRequiredSince && startOfUtcDay(user.workLogRequiredSince).getTime() > day) {
    return false;
  }
  if (user.startDate && startOfUtcDay(user.startDate).getTime() > day) return false;
  if (user.terminationDate && startOfUtcDay(user.terminationDate).getTime() < day) return false;
  return true;
}

/**
 * Week roll-up. `days` counts log rows — the (userId, workDate) unique
 * constraint guarantees one row per calendar day, so duplicates can't
 * double-count. Hours are rounded to 2 decimals to hide float noise.
 */
export function weekTotals(logs: { hours: number }[]): { totalHours: number; days: number } {
  const total = logs.reduce((sum, l) => sum + (l.hours || 0), 0);
  return { totalHours: Math.round(total * 100) / 100, days: logs.length };
}

const UTC_WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

/** Short weekday name of the UTC calendar day ("Mon"). TZ-stable. */
export function utcWeekdayName(date: Date): string {
  return UTC_WEEKDAYS[date.getUTCDay()];
}

/**
 * Can this user run the manager side of work logs (team matrix,
 * exceptions, OT approval, back-fill-window bypass)?
 *
 * Role defaults only hand the `canManage` flag to ADMIN/DEVELOPER, so a
 * plain-role MANAGER would be locked out of the very page the Monday
 * escalation links them to. Same solution as the workflows instance
 * page: MANAGER + module canEdit counts as managing. An explicit
 * ModulePermission row that strips canEdit/canManage still revokes it.
 */
export function canManageWorkLogs(
  role: string,
  perms: { canManage: boolean; canEdit: boolean }
): boolean {
  return perms.canManage || (role === "MANAGER" && perms.canEdit);
}
