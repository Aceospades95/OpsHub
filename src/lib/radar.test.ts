import { describe, it, expect, vi } from "vitest";

// radar.ts imports @/lib/db for the aggregation half; the pure
// date-window helpers under test never touch it. Same mocking idiom as
// permissions.test.ts.
vi.mock("@/lib/db", () => ({ db: {} }));

import {
  daysUntil,
  dueTone,
  daysRemainingLabel,
  radarHorizon,
  resolveRadarWindow,
  pickContractRadarDate,
  isStaleBidDeadline,
  DEFAULT_RADAR_WINDOW,
  DUE_SOON_DAYS,
} from "./radar";

/**
 * Fixed clock for every case: mid-afternoon UTC on Aug 25, 2026 — a
 * deliberate non-midnight instant, because stored calendar dates are
 * UTC midnights and the helpers must not care what time of day "now"
 * is (that time-of-day drift is the classic off-by-one source).
 */
const NOW = new Date("2026-08-25T15:30:00.000Z");

/** Stored-column shape: a calendar date at UTC midnight. */
function cal(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}

describe("daysUntil", () => {
  it("is 0 for today, even though today's UTC midnight already passed", () => {
    expect(daysUntil(cal("2026-08-25"), NOW)).toBe(0);
  });

  it("is 1 for tomorrow and -1 for yesterday", () => {
    expect(daysUntil(cal("2026-08-26"), NOW)).toBe(1);
    expect(daysUntil(cal("2026-08-24"), NOW)).toBe(-1);
  });

  it("counts a far-future date exactly", () => {
    // Aug 25 → Nov 23 is 90 days (Aug 6 + Sep 30 + Oct 31 + Nov 23).
    expect(daysUntil(cal("2026-11-23"), NOW)).toBe(90);
  });

  it("counts far-past dates negatively", () => {
    expect(daysUntil(cal("2026-07-01"), NOW)).toBe(-55);
  });

  it("ignores the time-of-day of `now` (midnight vs 23:59 agree)", () => {
    const target = cal("2026-08-30");
    expect(daysUntil(target, new Date("2026-08-25T00:00:00.000Z"))).toBe(5);
    expect(daysUntil(target, new Date("2026-08-25T23:59:59.999Z"))).toBe(5);
  });

  it("crosses a year boundary without drift", () => {
    expect(daysUntil(cal("2027-01-01"), new Date("2026-12-31T18:00:00.000Z"))).toBe(1);
  });
});

describe("radarHorizon ↔ daysUntil boundary agreement", () => {
  // The SQL filter is `date <= radarHorizon(now, N)`; the badge shows
  // daysUntil(). For UTC-midnight stored dates the two must agree at
  // the boundary: exactly N days out is in-window, N+1 is not.
  it("includes a date exactly N days out and excludes N+1", () => {
    const horizon = radarHorizon(NOW, 30);
    const dayThirty = cal("2026-09-24");
    const dayThirtyOne = cal("2026-09-25");
    expect(daysUntil(dayThirty, NOW)).toBe(30);
    expect(dayThirty.getTime()).toBeLessThanOrEqual(horizon.getTime());
    expect(daysUntil(dayThirtyOne, NOW)).toBe(31);
    expect(dayThirtyOne.getTime()).toBeGreaterThan(horizon.getTime());
  });

  it("agrees even when `now` is exactly UTC midnight", () => {
    const midnightNow = new Date("2026-08-25T00:00:00.000Z");
    const horizon = radarHorizon(midnightNow, 30);
    expect(cal("2026-09-24").getTime()).toBeLessThanOrEqual(horizon.getTime());
    expect(cal("2026-09-25").getTime()).toBeGreaterThan(horizon.getTime());
  });
});

describe("dueTone", () => {
  it("is overdue for any past day", () => {
    expect(dueTone(-1)).toBe("overdue");
    expect(dueTone(-400)).toBe("overdue");
  });

  it("is soon from today through the 14-day boundary", () => {
    expect(dueTone(0)).toBe("soon");
    expect(dueTone(DUE_SOON_DAYS)).toBe("soon");
  });

  it("is ok past the boundary", () => {
    expect(dueTone(DUE_SOON_DAYS + 1)).toBe("ok");
    expect(dueTone(90)).toBe("ok");
  });
});

describe("daysRemainingLabel", () => {
  it("labels past, today, and future", () => {
    expect(daysRemainingLabel(-12)).toBe("12d overdue");
    expect(daysRemainingLabel(-1)).toBe("1d overdue");
    expect(daysRemainingLabel(0)).toBe("today");
    expect(daysRemainingLabel(1)).toBe("in 1d");
    expect(daysRemainingLabel(45)).toBe("in 45d");
  });
});

describe("resolveRadarWindow", () => {
  it("accepts each toggle value", () => {
    expect(resolveRadarWindow("30")).toBe(30);
    expect(resolveRadarWindow("60")).toBe(60);
    expect(resolveRadarWindow("90")).toBe(90);
    expect(resolveRadarWindow("180")).toBe(180);
  });

  it("defaults to 90 for missing or junk input", () => {
    expect(resolveRadarWindow(undefined)).toBe(DEFAULT_RADAR_WINDOW);
    expect(resolveRadarWindow("")).toBe(DEFAULT_RADAR_WINDOW);
    expect(resolveRadarWindow("45")).toBe(DEFAULT_RADAR_WINDOW);
    expect(resolveRadarWindow("-30")).toBe(DEFAULT_RADAR_WINDOW);
    expect(resolveRadarWindow("banana")).toBe(DEFAULT_RADAR_WINDOW);
  });

  it("uses the first value of a repeated param", () => {
    expect(resolveRadarWindow(["30", "180"])).toBe(30);
  });
});

describe("pickContractRadarDate", () => {
  it("picks the end date when only it is in-window", () => {
    const picked = pickContractRadarDate(
      { endDate: cal("2026-09-10"), renewalDate: cal("2027-06-01") },
      NOW,
      90
    );
    expect(picked).toEqual({ date: cal("2026-09-10"), kind: "end", daysRemaining: 16 });
  });

  it("picks the renewal date when it is the sooner in-window date", () => {
    const picked = pickContractRadarDate(
      { endDate: cal("2026-11-01"), renewalDate: cal("2026-09-01") },
      NOW,
      90
    );
    expect(picked?.kind).toBe("renewal");
    expect(picked?.daysRemaining).toBe(7);
  });

  it("picks a past date (overdue) over a future one", () => {
    const picked = pickContractRadarDate(
      { endDate: cal("2026-08-01"), renewalDate: cal("2026-09-15") },
      NOW,
      90
    );
    expect(picked?.kind).toBe("end");
    expect(picked?.daysRemaining).toBe(-24);
  });

  it("includes the window boundary day and excludes one past it", () => {
    expect(
      pickContractRadarDate({ endDate: cal("2026-09-24"), renewalDate: null }, NOW, 30)
        ?.daysRemaining
    ).toBe(30);
    expect(
      pickContractRadarDate({ endDate: cal("2026-09-25"), renewalDate: null }, NOW, 30)
    ).toBeNull();
  });

  it("returns null when both dates are missing or out of window", () => {
    expect(pickContractRadarDate({ endDate: null, renewalDate: null }, NOW, 90)).toBeNull();
    expect(
      pickContractRadarDate(
        { endDate: cal("2027-08-01"), renewalDate: cal("2027-09-01") },
        NOW,
        90
      )
    ).toBeNull();
  });
});

describe("isStaleBidDeadline", () => {
  it("flags only deadlines more than 30 days past", () => {
    expect(isStaleBidDeadline(-31)).toBe(true);
    expect(isStaleBidDeadline(-300)).toBe(true);
    expect(isStaleBidDeadline(-30)).toBe(false);
    expect(isStaleBidDeadline(-1)).toBe(false);
    expect(isStaleBidDeadline(0)).toBe(false);
    expect(isStaleBidDeadline(10)).toBe(false);
  });
});
