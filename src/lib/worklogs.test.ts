import { describe, it, expect } from "vitest";
import {
  OVERTIME_WEEK_HOURS,
  addUtcDays,
  canManageWorkLogs,
  expectedWorkdays,
  isExceptedDay,
  isValidWeekKey,
  isoWeekKey,
  missingDays,
  rosterWindow,
  shiftWeekKey,
  startOfUtcDay,
  utcWeekdayName,
  weekBounds,
  weekTotals,
} from "./worklogs";

/** UTC-midnight calendar date, the same shape the DB stores. */
const day = (s: string) => new Date(`${s}T00:00:00.000Z`);

describe("isoWeekKey", () => {
  it("keys a mid-year date with zero padding", () => {
    expect(isoWeekKey(day("2026-07-15"))).toBe("2026-W29"); // Wednesday
    expect(isoWeekKey(day("2026-01-05"))).toBe("2026-W02");
  });

  it("zero-pads single-digit weeks", () => {
    expect(isoWeekKey(day("2026-01-01"))).toBe("2026-W01");
  });

  it("Jan 1 belongs to week 1 of the NEW year when it's a Thursday", () => {
    // 2026-01-01 is a Thursday → its week (Mon 2025-12-29 …) is 2026-W01.
    expect(isoWeekKey(day("2026-01-01"))).toBe("2026-W01");
    expect(isoWeekKey(day("2025-12-29"))).toBe("2026-W01");
  });

  it("Jan 1 belongs to the OLD year's last week when the week is mostly old-year", () => {
    // 2028-01-01 is a Saturday → its week (Mon 2027-12-27 …) is 2027-W52.
    expect(isoWeekKey(day("2028-01-01"))).toBe("2027-W52");
    // 2027-01-01 is a Friday and 2026 is a 53-week ISO year.
    expect(isoWeekKey(day("2027-01-01"))).toBe("2026-W53");
  });

  it("is computed from the UTC calendar day, not the raw instant", () => {
    // 23:59 UTC on Sunday is still Sunday's week in every host TZ.
    expect(isoWeekKey(new Date("2026-07-19T23:59:59.000Z"))).toBe("2026-W29");
    expect(isoWeekKey(new Date("2026-07-20T00:00:00.000Z"))).toBe("2026-W30");
  });
});

describe("weekBounds", () => {
  it("returns UTC Monday..Sunday midnights", () => {
    const { start, end } = weekBounds("2026-W29");
    expect(start.toISOString()).toBe("2026-07-13T00:00:00.000Z");
    expect(end.toISOString()).toBe("2026-07-19T00:00:00.000Z");
  });

  it("handles week 1 spilling into the previous calendar year", () => {
    const { start, end } = weekBounds("2026-W01");
    expect(start.toISOString()).toBe("2025-12-29T00:00:00.000Z");
    expect(end.toISOString()).toBe("2026-01-04T00:00:00.000Z");
  });

  it("handles week 53 of a long ISO year", () => {
    const { start, end } = weekBounds("2026-W53");
    expect(start.toISOString()).toBe("2026-12-28T00:00:00.000Z");
    expect(end.toISOString()).toBe("2027-01-03T00:00:00.000Z");
  });

  it("round-trips with isoWeekKey", () => {
    for (const key of ["2026-W01", "2026-W29", "2026-W53", "2027-W52"]) {
      expect(isoWeekKey(weekBounds(key).start)).toBe(key);
      expect(isoWeekKey(weekBounds(key).end)).toBe(key);
    }
  });

  it("rejects malformed keys and weeks that don't exist", () => {
    expect(() => weekBounds("2026-29")).toThrow();
    expect(() => weekBounds("2026-W1")).toThrow();
    expect(() => weekBounds("2026-W00")).toThrow();
    expect(() => weekBounds("2026-W54")).toThrow();
    // 2025 is a 52-week ISO year — W53 must not silently alias 2026-W01.
    expect(() => weekBounds("2025-W53")).toThrow();
  });
});

describe("isValidWeekKey", () => {
  it("accepts real weeks and rejects everything else", () => {
    expect(isValidWeekKey("2026-W29")).toBe(true);
    expect(isValidWeekKey("2026-W53")).toBe(true);
    expect(isValidWeekKey("2025-W53")).toBe(false);
    expect(isValidWeekKey("2026-w29")).toBe(false);
    expect(isValidWeekKey("")).toBe(false);
    expect(isValidWeekKey(null)).toBe(false);
  });
});

describe("shiftWeekKey", () => {
  it("moves across ordinary weeks", () => {
    expect(shiftWeekKey("2026-W29", -1)).toBe("2026-W28");
    expect(shiftWeekKey("2026-W29", 1)).toBe("2026-W30");
    expect(shiftWeekKey("2026-W29", -4)).toBe("2026-W25");
  });

  it("moves across year boundaries including 53-week years", () => {
    expect(shiftWeekKey("2026-W01", -1)).toBe("2025-W52");
    expect(shiftWeekKey("2026-W53", 1)).toBe("2027-W01");
    expect(shiftWeekKey("2027-W01", -1)).toBe("2026-W53");
  });
});

describe("expectedWorkdays", () => {
  const monday = day("2026-07-13");

  it("returns Mon–Fri of the week", () => {
    const days = expectedWorkdays(monday);
    expect(days.map((d) => d.toISOString().slice(0, 10))).toEqual([
      "2026-07-13",
      "2026-07-14",
      "2026-07-15",
      "2026-07-16",
      "2026-07-17",
    ]);
  });

  it("clips to upTo for mid-week evaluation (inclusive)", () => {
    const days = expectedWorkdays(monday, { upTo: day("2026-07-14") });
    expect(days.map((d) => d.toISOString().slice(0, 10))).toEqual([
      "2026-07-13",
      "2026-07-14",
    ]);
  });

  it("upTo on/after Friday returns the full workweek; before Monday returns none", () => {
    expect(expectedWorkdays(monday, { upTo: day("2026-07-19") })).toHaveLength(5);
    expect(expectedWorkdays(monday, { upTo: day("2026-07-12") })).toHaveLength(0);
  });
});

describe("isExceptedDay / missingDays", () => {
  const week = expectedWorkdays(day("2026-07-13")); // Mon Jul 13 – Fri Jul 17

  it("exception ranges are inclusive on BOTH ends", () => {
    const exceptions = [{ startDate: day("2026-07-14"), endDate: day("2026-07-15") }];
    expect(isExceptedDay(day("2026-07-13"), exceptions)).toBe(false); // day before start
    expect(isExceptedDay(day("2026-07-14"), exceptions)).toBe(true); // start day
    expect(isExceptedDay(day("2026-07-15"), exceptions)).toBe(true); // end day
    expect(isExceptedDay(day("2026-07-16"), exceptions)).toBe(false); // day after end
  });

  it("a one-day exception (start === end) covers exactly that day", () => {
    const exceptions = [{ startDate: day("2026-07-15"), endDate: day("2026-07-15") }];
    expect(isExceptedDay(day("2026-07-15"), exceptions)).toBe(true);
    expect(isExceptedDay(day("2026-07-14"), exceptions)).toBe(false);
    expect(isExceptedDay(day("2026-07-16"), exceptions)).toBe(false);
  });

  it("returns expected days that are neither logged nor excepted", () => {
    const missing = missingDays({
      weekDates: week,
      logs: [{ workDate: day("2026-07-13") }, { workDate: day("2026-07-16") }],
      exceptions: [{ startDate: day("2026-07-14"), endDate: day("2026-07-14") }],
    });
    expect(missing.map((d) => d.toISOString().slice(0, 10))).toEqual([
      "2026-07-15",
      "2026-07-17",
    ]);
  });

  it("an exception spanning the whole week clears everything", () => {
    const missing = missingDays({
      weekDates: week,
      logs: [],
      exceptions: [{ startDate: day("2026-07-06"), endDate: day("2026-08-01") }],
    });
    expect(missing).toHaveLength(0);
  });

  it("exceptions clipped to part of the week leave the rest missing", () => {
    const missing = missingDays({
      weekDates: week,
      logs: [],
      // Range ends Wednesday — Thu/Fri stay expected.
      exceptions: [{ startDate: day("2026-07-01"), endDate: day("2026-07-15") }],
    });
    expect(missing.map((d) => d.toISOString().slice(0, 10))).toEqual([
      "2026-07-16",
      "2026-07-17",
    ]);
  });

  it("logs at non-midnight instants still count for their UTC day", () => {
    const missing = missingDays({
      weekDates: week,
      logs: [{ workDate: new Date("2026-07-13T15:30:00.000Z") }],
      exceptions: [],
    });
    expect(missing.map((d) => d.toISOString().slice(0, 10))).not.toContain("2026-07-13");
  });
});

describe("rosterWindow", () => {
  const base = { isActive: true, hasLoginAccess: true, terminationDate: null, startDate: null };
  const d = day("2026-07-15");

  it("active users with login access count", () => {
    expect(rosterWindow(base, d)).toBe(true);
  });

  it("inactive or no-login users never count", () => {
    expect(rosterWindow({ ...base, isActive: false }, d)).toBe(false);
    expect(rosterWindow({ ...base, hasLoginAccess: false }, d)).toBe(false);
  });

  it("terminationDate is the LAST counted day (inclusive)", () => {
    const user = { ...base, terminationDate: day("2026-07-15") };
    expect(rosterWindow(user, day("2026-07-14"))).toBe(true);
    expect(rosterWindow(user, day("2026-07-15"))).toBe(true);
    expect(rosterWindow(user, day("2026-07-16"))).toBe(false);
  });

  it("startDate is the FIRST counted day (inclusive)", () => {
    const user = { ...base, startDate: day("2026-07-15") };
    expect(rosterWindow(user, day("2026-07-14"))).toBe(false);
    expect(rosterWindow(user, day("2026-07-15"))).toBe(true);
    expect(rosterWindow(user, day("2026-07-16"))).toBe(true);
  });

  it("startDate with a time component counts from that calendar day", () => {
    // createdAt is a real timestamp — someone added Wednesday 15:33 UTC
    // still counts for Wednesday itself.
    const user = { ...base, startDate: new Date("2026-07-15T15:33:00.000Z") };
    expect(rosterWindow(user, day("2026-07-15"))).toBe(true);
  });
});

describe("weekTotals", () => {
  it("sums hours and counts days", () => {
    expect(weekTotals([{ hours: 8 }, { hours: 9.5 }, { hours: 7 }])).toEqual({
      totalHours: 24.5,
      days: 3,
    });
  });

  it("returns zeros for an empty week", () => {
    expect(weekTotals([])).toEqual({ totalHours: 0, days: 0 });
  });

  it("rounds float noise to 2 decimals", () => {
    // 7.7 * 3 is 23.099999999999998 in IEEE754.
    expect(weekTotals([{ hours: 7.7 }, { hours: 7.7 }, { hours: 7.7 }]).totalHours).toBe(23.1);
  });

  it("exports the 40h overtime threshold", () => {
    expect(OVERTIME_WEEK_HOURS).toBe(40);
  });
});

describe("canManageWorkLogs", () => {
  it("canManage always qualifies", () => {
    expect(canManageWorkLogs("ADMIN", { canManage: true, canEdit: true })).toBe(true);
    expect(canManageWorkLogs("CONTRIBUTOR", { canManage: true, canEdit: false })).toBe(true);
  });

  it("MANAGER role qualifies via module canEdit (role defaults)", () => {
    expect(canManageWorkLogs("MANAGER", { canManage: false, canEdit: true })).toBe(true);
    // An explicit permission row stripping canEdit revokes it.
    expect(canManageWorkLogs("MANAGER", { canManage: false, canEdit: false })).toBe(false);
  });

  it("field tier never qualifies without the flag", () => {
    expect(canManageWorkLogs("CONTRIBUTOR", { canManage: false, canEdit: true })).toBe(false);
    expect(canManageWorkLogs("VIEWER", { canManage: false, canEdit: false })).toBe(false);
  });
});

describe("UTC day helpers", () => {
  it("startOfUtcDay truncates by UTC day", () => {
    expect(startOfUtcDay(new Date("2026-07-15T23:59:59.999Z")).toISOString()).toBe(
      "2026-07-15T00:00:00.000Z"
    );
  });

  it("addUtcDays crosses month boundaries", () => {
    expect(addUtcDays(day("2026-07-31"), 1).toISOString().slice(0, 10)).toBe("2026-08-01");
    expect(addUtcDays(day("2026-07-01"), -1).toISOString().slice(0, 10)).toBe("2026-06-30");
  });

  it("utcWeekdayName reads the UTC weekday", () => {
    expect(utcWeekdayName(day("2026-07-13"))).toBe("Mon");
    expect(utcWeekdayName(day("2026-07-19"))).toBe("Sun");
  });
});
