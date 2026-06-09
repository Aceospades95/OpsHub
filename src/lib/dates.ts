/**
 * Calendar-date utilities.
 *
 * Use these for any value the user enters via `<input type="date">` —
 * project start/end, task due date, certification expiration, contract
 * dates, etc. — i.e. fields where what matters is *which calendar day*
 * and not *what instant in time*.
 *
 * Background
 * ----------
 * Calendar dates in this codebase are stored as `DateTime` columns in
 * Postgres. The action does `new Date("YYYY-MM-DD")` on the form
 * value, which gives UTC midnight (per ISO-8601 short form). Postgres
 * stores the UTC instant. So Jan 1, 2026 entered by a user in PST is
 * persisted as `2026-01-01T00:00:00Z`.
 *
 * Rendering that value with date-fns `format()` uses the *local*
 * timezone — UTC midnight Jan 1 reads as `Dec 31, 2025 4 PM` in PST,
 * and `format(d, "MMM d, yyyy")` shows `"Dec 31, 2025"`. That's the
 * timezone bug surfaced by the QA pass: a "calendar" value rendered
 * one day (and sometimes one *year*) earlier than the user picked.
 *
 * The fix here is purely render-layer: format the stored UTC instant
 * *as if it were UTC* so the displayed calendar date always matches
 * the calendar date the user picked, regardless of viewer TZ.
 *
 * The proper long-term fix is migrating these columns to Postgres
 * `@db.Date` (no time component, no TZ ambiguity) — that's deliberately
 * deferred per the QA plan. Until then, route every calendar-date
 * render through `formatCalendarDate()`.
 *
 * Helpers in this module:
 *   - `formatCalendarDate(value, fmt)` — TZ-stable display.
 *   - `toCalendarDateString(value)` — Date → "YYYY-MM-DD" for form
 *     defaultValues on `<input type="date">`.
 *   - `parseCalendarDateString(str)` — "YYYY-MM-DD" → Date (UTC midnight)
 *     for action input.
 */

/**
 * Calendar-date format names allowed by `formatCalendarDate`. Add new
 * tokens deliberately — the goal is to keep calendar-date rendering
 * narrow enough that we know we never accidentally drop a TZ-stable
 * formatter for a viewer-TZ one.
 *
 * Token names mirror the date-fns format strings the codebase uses so
 * the migration from `format(d, "MMM d, yyyy")` → `formatCalendarDate(
 * d, "MMM d, yyyy")` is a single grep-and-replace per format.
 */
const CALENDAR_FORMATS: Record<string, Intl.DateTimeFormatOptions> = {
  d: { day: "numeric" },
  MMM: { month: "short" },
  "MMM d": { month: "short", day: "numeric" },
  "MMM d, yyyy": { month: "short", day: "numeric", year: "numeric" },
  "MMMM d, yyyy": { month: "long", day: "numeric", year: "numeric" },
  "MMM yyyy": { month: "short", year: "numeric" },
  "MMMM yyyy": { month: "long", year: "numeric" },
  yyyy: { year: "numeric" },
};

export type CalendarFormatToken = keyof typeof CALENDAR_FORMATS;

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function getFormatter(fmt: CalendarFormatToken): Intl.DateTimeFormat {
  let formatter = formatterCache.get(fmt);
  if (!formatter) {
    const opts = CALENDAR_FORMATS[fmt];
    formatter = new Intl.DateTimeFormat("en-US", {
      ...opts,
      // Always format in UTC. By construction, a UTC-midnight stored
      // value renders as the same calendar date the user picked, in
      // any viewer's locale or timezone.
      timeZone: "UTC",
    });
    formatterCache.set(fmt, formatter);
  }
  return formatter;
}

/**
 * Format a calendar date for display. Renders the UTC representation of
 * the value, which is what makes this TZ-stable: a UTC-midnight stored
 * value always shows the calendar date the user picked, regardless of
 * the viewer's timezone.
 *
 * Returns "" for null / undefined / invalid input so callers don't have
 * to write `value ? formatCalendarDate(value, fmt) : ""` everywhere.
 */
export function formatCalendarDate(
  value: Date | string | null | undefined,
  fmt: CalendarFormatToken
): string {
  if (value == null) return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return getFormatter(fmt).format(date);
}

/**
 * Convert a calendar date to the "YYYY-MM-DD" string consumed by
 * `<input type="date">`. Stored UTC-midnight values round-trip
 * losslessly via `toISOString().slice(0, 10)`.
 */
export function toCalendarDateString(
  value: Date | string | null | undefined
): string {
  if (value == null) return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
}

/**
 * Parse a "YYYY-MM-DD" string into a Date at UTC midnight. Anything
 * else (empty, malformed, ISO with a time component) returns `null`.
 *
 * `new Date("YYYY-MM-DD")` is interpreted as UTC midnight per ISO-8601
 * short form — that's what we want. Adding a time component would make
 * Node interpret it as *local* time, which is the foot-gun this module
 * exists to avoid.
 */
export function parseCalendarDateString(
  s: string | null | undefined
): Date | null {
  if (!s) return null;
  // Reject anything that isn't a strict YYYY-MM-DD so we never
  // accidentally accept a local-time ISO timestamp.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const date = new Date(s);
  if (Number.isNaN(date.getTime())) return null;
  // `new Date("2026-02-30")` silently rolls over to Mar 2 instead of
  // failing — verify the round-trip so impossible calendar dates are
  // rejected rather than shifted.
  const [y, m, d] = s.split("-").map(Number);
  if (
    date.getUTCFullYear() !== y ||
    date.getUTCMonth() + 1 !== m ||
    date.getUTCDate() !== d
  ) {
    return null;
  }
  return date;
}

/**
 * `true` if `end >= start` for a pair of "YYYY-MM-DD" strings, treating
 * either side missing as valid (a one-sided range is fine; only an
 * inverted pair is wrong). Used by the zod refinements in the project,
 * quote, contract, and certification create/update actions.
 */
export function isValidCalendarRange(
  start: string | null | undefined,
  end: string | null | undefined
): boolean {
  if (!start || !end) return true;
  const s = parseCalendarDateString(start);
  const e = parseCalendarDateString(end);
  if (!s || !e) return true; // malformed dates fail elsewhere; don't double-flag
  return e.getTime() >= s.getTime();
}
