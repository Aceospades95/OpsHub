/**
 * Permutation matrices for the work-log rules engine.
 *
 * Complements worklogs.test.ts (per-function spot checks) with:
 *   - ISO week keys/bounds across year boundaries, a 53-week year, and
 *     leap day — plus host-timezone stability under a flipped TZ
 *   - the roster composition the report/job/team page actually run:
 *     expectedWorkdays(...).filter(rosterWindow) → missingDays
 *   - exception semantics: org-wide (userId null) vs personal rows,
 *     and all five ScheduleExceptionType values
 *   - overtime boundary math around OVERTIME_WEEK_HOURS
 *   - a rosterWindow truth table of multi-factor combinations
 *
 * Pure functions only — no db.
 */
import { describe, it, expect } from "vitest";

import {
  OVERTIME_WEEK_HOURS,
  expectedWorkdays,
  isoWeekKey,
  missingDays,
  rosterWindow,
  utcWeekdayName,
  weekBounds,
  weekTotals,
  type RosterWindowUser,
} from "./worklogs";

/** UTC-midnight calendar date, the shape the DB stores. */
const day = (s: string) => new Date(`${s}T00:00:00.000Z`);
const iso = (d: Date) => d.toISOString().slice(0, 10);
const DAY_MS = 24 * 60 * 60 * 1000;

describe("isoWeekKey — year-boundary / leap-year permutations", () => {
  // date → expected key (2020 is a 53-week ISO year; 2024 is a leap year)
  it.each([
    ["2024-02-29", "2024-W09"], // leap day (Thursday) sits mid-week
    ["2024-07-10", "2024-W28"], // plain mid-year Wednesday of a leap year
    ["2024-12-29", "2024-W52"], // Sunday still closes the old year's W52
    ["2024-12-30", "2025-W01"], // Monday Dec 30 already opens 2025-W01
    ["2024-12-31", "2025-W01"], // Dec 31 carried into the new year's W01
    ["2019-12-30", "2020-W01"], // Monday Dec 30 opens 2020-W01
    ["2020-12-28", "2020-W53"], // Monday of the 53rd week
    ["2021-01-01", "2020-W53"], // Jan 1 (Friday) belongs to the PRIOR 53-week year
    ["2021-01-03", "2020-W53"], // Sunday closes that same week
  ])("%s → %s", (date, key) => {
    expect(isoWeekKey(day(date))).toBe(key);
  });

  it("Monday and Sunday of one ISO week always share the key", () => {
    for (const key of ["2020-W53", "2025-W01", "2024-W09"]) {
      const { start, end } = weekBounds(key);
      expect([isoWeekKey(start), isoWeekKey(end)]).toEqual([key, key]);
    }
  });
});

describe("weekBounds — edge weeks are UTC Monday..Sunday midnights", () => {
  // key → [Monday ISO, Sunday ISO]; UTC weekday 1=Mon, 0=Sun
  it.each([
    ["2025-W01", "2024-12-30T00:00:00.000Z", "2025-01-05T00:00:00.000Z"],
    ["2020-W53", "2020-12-28T00:00:00.000Z", "2021-01-03T00:00:00.000Z"],
    ["2024-W09", "2024-02-26T00:00:00.000Z", "2024-03-03T00:00:00.000Z"], // spans Feb 29
  ])("%s spans %s .. %s", (key, startIso, endIso) => {
    const { start, end } = weekBounds(key);
    expect({
      start: start.toISOString(),
      end: end.toISOString(),
      startWeekday: start.getUTCDay(),
      endWeekday: end.getUTCDay(),
      spanDays: (end.getTime() - start.getTime()) / DAY_MS,
    }).toEqual({ start: startIso, end: endIso, startWeekday: 1, endWeekday: 0, spanDays: 6 });
  });
});

describe("host-timezone stability", () => {
  /** Run `fn` with the process TZ flipped (Node on Linux honors runtime changes). */
  function withTZ(tz: string, fn: () => void): void {
    const prev = process.env.TZ;
    process.env.TZ = tz;
    try {
      fn();
    } finally {
      if (prev === undefined) delete process.env.TZ;
      else process.env.TZ = prev;
    }
  }

  it("week keys, bounds, and day compares are identical west of UTC", () => {
    withTZ("America/Chicago", () => {
      // Sanity: the flip actually took effect (CDT = UTC-5 in July).
      expect(new Date(2026, 6, 15).getTimezoneOffset()).toBe(300);
      // Near-midnight-UTC dates are exactly where a local-TZ read would
      // shift the day (and at year end, the whole week-year).
      expect(isoWeekKey(day("2021-01-01"))).toBe("2020-W53");
      expect(isoWeekKey(day("2024-12-30"))).toBe("2025-W01");
      expect(weekBounds("2025-W01").start.toISOString()).toBe("2024-12-30T00:00:00.000Z");
      // rosterWindow's same-day UTC compare must not shift either.
      const user: RosterWindowUser = {
        isActive: true,
        hasLoginAccess: true,
        workLogRequired: true,
        workLogRequiredSince: day("2026-07-15"),
      };
      expect(rosterWindow(user, day("2026-07-15"))).toBe(true);
    });
  });
});

// ── Roster composition: exactly how the report, reminder job, and team
//    page derive "days this user owes" (see reports/work-logs-weekly.ts
//    and jobs/work-log-reminders.ts):
//    expectedWorkdays(start, {upTo?}).filter(d => rosterWindow(user, d))
const MONDAY = day("2026-07-13"); // Mon Jul 13 .. Fri Jul 17
const BASE: RosterWindowUser = {
  isActive: true,
  hasLoginAccess: true,
  workLogRequired: true,
  workLogRequiredSince: null,
  terminationDate: null,
  startDate: null,
};

function rosterDays(over: Partial<RosterWindowUser>, opts: { upTo?: Date } = {}): string[] {
  return expectedWorkdays(MONDAY, opts)
    .filter((d) => rosterWindow({ ...BASE, ...over }, d))
    .map(iso);
}

describe("enrollment windows compose with expectedWorkdays", () => {
  it("fully enrolled → all five weekdays", () => {
    expect(rosterDays({})).toEqual([
      "2026-07-13",
      "2026-07-14",
      "2026-07-15",
      "2026-07-16",
      "2026-07-17",
    ]);
  });

  it("enrolled Wednesday → Mon/Tue never expected", () => {
    expect(rosterDays({ workLogRequiredSince: day("2026-07-15") })).toEqual([
      "2026-07-15",
      "2026-07-16",
      "2026-07-17",
    ]);
  });

  it("started (createdAt) Thursday → only Thu/Fri expected", () => {
    expect(rosterDays({ startDate: day("2026-07-16") })).toEqual([
      "2026-07-16",
      "2026-07-17",
    ]);
  });

  it("terminated Wednesday → Mon..Wed stay expected, Thu/Fri released", () => {
    expect(rosterDays({ terminationDate: day("2026-07-15") })).toEqual([
      "2026-07-13",
      "2026-07-14",
      "2026-07-15",
    ]);
  });

  it("enrolled Wednesday AND terminated Thursday → exactly Wed+Thu", () => {
    expect(
      rosterDays({
        workLogRequiredSince: day("2026-07-15"),
        terminationDate: day("2026-07-16"),
      })
    ).toEqual(["2026-07-15", "2026-07-16"]);
  });

  it("not enrolled → zero expected days no matter how active", () => {
    expect(rosterDays({ workLogRequired: false })).toEqual([]);
  });

  it("an enrollment timestamp with a time-of-day still counts its own day", () => {
    expect(
      rosterDays({ workLogRequiredSince: new Date("2026-07-15T15:33:00.000Z") })
    ).toContain("2026-07-15");
  });

  it("mid-week evaluation: enrollment + upTo intersect", () => {
    expect(
      rosterDays({ workLogRequiredSince: day("2026-07-15") }, { upTo: day("2026-07-16") })
    ).toEqual(["2026-07-15", "2026-07-16"]);
  });
});

describe("exception permutations", () => {
  const week = expectedWorkdays(MONDAY);

  /** ScheduleException rows as the job fetches them (userId null = org-wide). */
  type ExceptionRow = { userId: string | null; startDate: Date; endDate: Date; type: string };
  /** The job's filter convention: own rows + org-wide rows. */
  const forUser = (rows: ExceptionRow[], userId: string) =>
    rows.filter((e) => e.userId === userId || e.userId === null);

  it("an org-wide holiday (userId null) clears the day for EVERYONE; personal PTO only for its owner", () => {
    const rows: ExceptionRow[] = [
      { userId: null, startDate: day("2026-07-15"), endDate: day("2026-07-15"), type: "HOLIDAY" },
      { userId: "u1", startDate: day("2026-07-16"), endDate: day("2026-07-16"), type: "PTO" },
    ];
    const missingFor = (userId: string) =>
      missingDays({ weekDates: week, logs: [], exceptions: forUser(rows, userId) }).map(iso);
    // u1: holiday AND their PTO honored.
    expect(missingFor("u1")).toEqual(["2026-07-13", "2026-07-14", "2026-07-17"]);
    // u2: only the org-wide holiday — u1's PTO must not leak over.
    expect(missingFor("u2")).toEqual(["2026-07-13", "2026-07-14", "2026-07-16", "2026-07-17"]);
  });

  it.each(["PTO", "SICK", "HOLIDAY", "UNPAID", "OTHER"])(
    "%s suppresses the expectation — ExceptionRange is type-agnostic",
    (type) => {
      const row: ExceptionRow = {
        userId: "u1",
        type,
        startDate: day("2026-07-15"),
        endDate: day("2026-07-15"),
      };
      const missing = missingDays({ weekDates: week, logs: [], exceptions: [row] }).map(iso);
      expect(missing).toEqual(["2026-07-13", "2026-07-14", "2026-07-16", "2026-07-17"]);
    }
  );

  it("a log submitted ON an excepted day: never 'missing', and its hours still count in totals", () => {
    const exceptions = [{ startDate: day("2026-07-15"), endDate: day("2026-07-15") }];
    const logs = [{ workDate: day("2026-07-15"), hours: 8 }];
    const missing = missingDays({ weekDates: week, logs, exceptions }).map(iso);
    expect(missing).toEqual(["2026-07-13", "2026-07-14", "2026-07-16", "2026-07-17"]);
    // weekTotals is exception-blind — worked holidays count toward hours.
    expect(weekTotals(logs)).toEqual({ totalHours: 8, days: 1 });
  });

  it("weekends are never expected, so weekend exceptions are no-ops", () => {
    expect(week.map(utcWeekdayName)).toEqual(["Mon", "Tue", "Wed", "Thu", "Fri"]);
    const satOnly = [{ startDate: day("2026-07-18"), endDate: day("2026-07-19") }];
    expect(missingDays({ weekDates: week, logs: [], exceptions: satOnly })).toHaveLength(5);
  });
});

describe("future days — missingDays only sees days up to the cutoff", () => {
  it("evaluated Wednesday, nothing logged → Thu/Fri are NOT flagged yet", () => {
    const weekSoFar = expectedWorkdays(MONDAY, { upTo: day("2026-07-15") });
    const missing = missingDays({ weekDates: weekSoFar, logs: [], exceptions: [] }).map(iso);
    expect(missing).toEqual(["2026-07-13", "2026-07-14", "2026-07-15"]);
  });

  it("upTo exactly Monday → only Monday is due", () => {
    expect(expectedWorkdays(MONDAY, { upTo: MONDAY }).map(iso)).toEqual(["2026-07-13"]);
  });

  it("a mid-day 'now' still includes today (cutoff is by UTC calendar day)", () => {
    const upTo = new Date("2026-07-15T09:30:00.000Z");
    expect(expectedWorkdays(MONDAY, { upTo }).map(iso)).toEqual([
      "2026-07-13",
      "2026-07-14",
      "2026-07-15",
    ]);
  });
});

describe("weekTotals — overtime boundary + aggregation shape", () => {
  // The pages/report compare with STRICT >, so exactly 40.0 is not OT
  // (see work-logs/page.tsx `totals.totalHours > OVERTIME_WEEK_HOURS`).
  it.each([
    [[8, 8, 8, 8, 7.99], 39.99, false],
    [[8, 8, 8, 8, 8], 40, false],
    [[8, 8, 8, 8, 8.01], 40.01, true],
  ])("hours %j → total %d, overtime=%s", (hours, total, overtime) => {
    const totals = weekTotals(hours.map((h) => ({ hours: h })));
    expect(totals.totalHours).toBe(total);
    expect(totals.totalHours > OVERTIME_WEEK_HOURS).toBe(overtime);
  });

  it("a 0-hour log still counts as a submitted day", () => {
    expect(weekTotals([{ hours: 0 }])).toEqual({ totalHours: 0, days: 1 });
  });

  it("defensively treats missing hours as 0 (the `|| 0` guard)", () => {
    expect(
      weekTotals([{ hours: undefined as unknown as number }, { hours: 8 }])
    ).toEqual({ totalHours: 8, days: 2 });
  });

  it("per-user grouping keeps totals independent (job's Map-by-userId shape)", () => {
    const logs = [
      { userId: "u1", hours: 39 },
      { userId: "u2", hours: 41 },
      { userId: "u1", hours: 2 },
    ];
    const byUser = new Map<string, { hours: number }[]>();
    for (const l of logs) byUser.set(l.userId, [...(byUser.get(l.userId) ?? []), l]);
    expect([
      weekTotals(byUser.get("u1") ?? []).totalHours,
      weekTotals(byUser.get("u2") ?? []).totalHours,
    ]).toEqual([41, 41]);
  });
});

describe("rosterWindow — full truth table", () => {
  const AT = day("2026-07-15"); // the queried day (a Wednesday)

  // label, user overrides, expected
  it.each<[string, Partial<RosterWindowUser>, boolean]>([
    ["all-clear enrollment", {}, true],
    // THE mass-email regression: nothing else matters when not enrolled.
    ["workLogRequired=false, everything else perfect", { workLogRequired: false }, false],
    [
      "workLogRequired=false even with a past enrollment date on file",
      { workLogRequired: false, workLogRequiredSince: day("2026-01-01") },
      false,
    ],
    ["inactive", { isActive: false }, false],
    ["no login access (placeholder account)", { hasLoginAccess: false }, false],
    [
      "inactive + no login + long terminated",
      { isActive: false, hasLoginAccess: false, terminationDate: day("2026-01-31") },
      false,
    ],
    ["enrolled tomorrow", { workLogRequiredSince: day("2026-07-16") }, false],
    ["enrolled exactly today (UTC day compare)", { workLogRequiredSince: AT }, true],
    [
      "enrolled today at 18:00 UTC — time of day ignored",
      { workLogRequiredSince: new Date("2026-07-15T18:00:00.000Z") },
      true,
    ],
    ["starts tomorrow", { startDate: day("2026-07-16") }, false],
    ["terminated yesterday", { terminationDate: day("2026-07-14") }, false],
    ["termination day itself still counts (inclusive)", { terminationDate: AT }, true],
    [
      "one-day employment: start = termination = queried day",
      { startDate: AT, terminationDate: AT },
      true,
    ],
    [
      "terminated before the query even though enrolled earlier",
      { workLogRequiredSince: day("2026-07-10"), terminationDate: day("2026-07-01") },
      false,
    ],
  ])("%s → %s", (_label, over, expected) => {
    expect(rosterWindow({ ...BASE, ...over }, AT)).toBe(expected);
  });
});
