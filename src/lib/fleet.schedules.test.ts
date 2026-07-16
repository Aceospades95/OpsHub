/**
 * Boundary-permutation matrices for fleet service schedules.
 *
 * Complements fleet.test.ts (happy paths + the 14-day/500-mile window
 * edges) with:
 *   - a fine-grained due-DATE sweep including the exact due instant,
 *     "due earlier today", and 1-day/1-year overdue
 *   - addMonths month-end clamping feeding dueDate
 *   - a due-MILEAGE sweep including 1 mile before/at/over due
 *   - per-bound missing-baseline permutations
 *   - the both-bounds combination table (most urgent wins)
 *   - registrationDueState checkpoints (14/7/1/same-day/expired)
 *   - vehicleScheduleSummary severity ordering + nextDue tie-breaks
 *   - the LEGACY maintenanceDueState (untested elsewhere)
 *
 * Pure functions only — no db. Host TZ is UTC (as in CI); date-math
 * fixtures use 12:00Z instants so calendar-day expectations also hold
 * on hosts a few hours off UTC.
 */
import { describe, it, expect } from "vitest";

import {
  maintenanceDueState,
  registrationDueState,
  scheduleDueState,
  vehicleScheduleSummary,
} from "./fleet";

const NOW = new Date("2026-07-16T12:00:00.000Z");
const daysFromNow = (d: number) => new Date(NOW.getTime() + d * 24 * 60 * 60 * 1000);

const schedule = (over: Partial<Parameters<typeof scheduleDueState>[0]> = {}) => ({
  everyMonths: null,
  everyMiles: null,
  lastServiceDate: null,
  lastServiceMileage: null,
  ...over,
});

describe("scheduleDueState — due-date boundary sweep (everyMonths only)", () => {
  const timeOnly = (lastServiceDate: string) =>
    scheduleDueState(
      schedule({ everyMonths: 1, lastServiceDate: new Date(lastServiceDate) }),
      { currentMileage: null },
      NOW
    );

  // last service (+1 month = due date) → [daysRemaining, status]
  it.each([
    ["2026-07-01T00:00:00.000Z", 15, "ok"], // one day past the window
    ["2026-06-30T12:00:00.000Z", 14, "due-soon"], // exactly at the window
    ["2026-06-17T12:00:00.000Z", 1, "due-soon"], // due tomorrow
    // Due at EXACTLY the current instant: the overdue compare is a
    // strict `<`, so this is still due-soon with 0 days remaining.
    ["2026-06-16T12:00:00.000Z", 0, "due-soon"],
    // Due earlier TODAY (12h ago): instant compare flips to overdue
    // even though differenceInDays still reports 0.
    ["2026-06-16T00:00:00.000Z", 0, "overdue"],
    ["2026-06-15T12:00:00.000Z", -1, "overdue"], // one full day overdue
    ["2025-06-16T12:00:00.000Z", -365, "overdue"], // a year overdue
  ])("last serviced %s → %d days remaining, %s", (last, days, status) => {
    expect(timeOnly(last)).toMatchObject({ daysRemaining: days, status });
  });

  it("time-only schedules never produce mileage fields", () => {
    expect(timeOnly("2026-07-01T00:00:00.000Z")).toMatchObject({
      dueDate: new Date("2026-08-01T00:00:00.000Z"),
      dueMileage: null,
      milesRemaining: null,
    });
  });
});

describe("scheduleDueState — dueDate month arithmetic clamps at month end", () => {
  // lastServiceDate, everyMonths → expected dueDate (date-fns addMonths)
  it.each([
    ["2026-01-31T12:00:00.000Z", 1, "2026-02-28T12:00:00.000Z"], // short Feb
    ["2024-01-31T12:00:00.000Z", 1, "2024-02-29T12:00:00.000Z"], // leap Feb
    ["2026-08-31T12:00:00.000Z", 1, "2026-09-30T12:00:00.000Z"], // 31st → 30-day month
  ])("%s + %d month → %s", (last, months, due) => {
    const state = scheduleDueState(
      schedule({ everyMonths: months, lastServiceDate: new Date(last) }),
      { currentMileage: null },
      NOW
    );
    expect(state.dueDate?.toISOString()).toBe(due);
  });
});

describe("scheduleDueState — due-mileage boundary sweep (everyMiles only)", () => {
  const milesOnly = (currentMileage: number) =>
    scheduleDueState(
      schedule({ everyMiles: 5_000, lastServiceMileage: 60_000 }), // due at 65,000
      { currentMileage },
      NOW
    );

  // odometer → [milesRemaining, status]
  it.each([
    [64_499, 501, "ok"], // one mile outside the window
    [64_500, 500, "due-soon"], // exactly at the window
    [64_999, 1, "due-soon"], // one mile before due
    [65_000, 0, "overdue"], // exactly at due mileage (<= 0)
    [65_001, -1, "overdue"], // one mile over
  ])("odometer %d → %d miles remaining, %s", (odo, remaining, status) => {
    expect(milesOnly(odo)).toMatchObject({
      dueMileage: 65_000,
      milesRemaining: remaining,
      status,
    });
  });

  it("miles-only schedules never produce date fields", () => {
    expect(milesOnly(64_499)).toMatchObject({ dueDate: null, daysRemaining: null });
  });
});

describe("scheduleDueState — missing baseline / cadence permutations", () => {
  it("mileage cadence WITHOUT lastServiceMileage is unknown even with an odometer", () => {
    const state = scheduleDueState(
      schedule({ everyMiles: 5_000 }),
      { currentMileage: 64_000 },
      NOW
    );
    expect(state).toMatchObject({ status: "unknown", dueMileage: null, milesRemaining: null });
  });

  it("date cadence WITHOUT lastServiceDate is unknown", () => {
    const state = scheduleDueState(
      schedule({ everyMonths: 3 }),
      { currentMileage: 64_000 },
      NOW
    );
    expect(state).toMatchObject({ status: "unknown", dueDate: null, daysRemaining: null });
  });

  it("baselines without any cadence are unknown (nothing to project forward)", () => {
    const state = scheduleDueState(
      schedule({
        lastServiceDate: new Date("2026-06-01T00:00:00.000Z"),
        lastServiceMileage: 60_000,
      }),
      { currentMileage: 64_000 },
      NOW
    );
    expect(state.status).toBe("unknown");
  });

  it("a fully-blank schedule reports unknown with every derived field null", () => {
    expect(scheduleDueState(schedule(), { currentMileage: null }, NOW)).toEqual({
      dueDate: null,
      dueMileage: null,
      milesRemaining: null,
      daysRemaining: null,
      status: "unknown",
    });
  });
});

describe("scheduleDueState — both bounds: the more urgent one wins", () => {
  // everyMonths 2 / everyMiles 5,000; vary the baselines + odometer.
  const both = (lastServiceDate: string, lastServiceMileage: number, currentMileage: number) =>
    scheduleDueState(
      schedule({
        everyMonths: 2,
        everyMiles: 5_000,
        lastServiceDate: new Date(lastServiceDate),
        lastServiceMileage,
      }),
      { currentMileage },
      NOW
    );

  it.each([
    // label, lastServiceDate, lastMileage, odometer, expected status
    ["date overdue + miles fine", "2026-05-01T00:00:00.000Z", 60_000, 61_000, "overdue"],
    ["both overdue", "2026-04-01T00:00:00.000Z", 60_000, 66_000, "overdue"],
    ["date due-soon + miles AT due → overdue wins", "2026-05-20T12:00:00.000Z", 60_000, 65_000, "overdue"],
    ["date due-soon + miles due-soon", "2026-05-20T12:00:00.000Z", 60_000, 64_700, "due-soon"],
    ["both comfortably ok", "2026-07-01T00:00:00.000Z", 60_000, 61_000, "ok"],
  ])("%s", (_label, last, lastMiles, odo, status) => {
    expect(both(last, lastMiles, odo).status).toBe(status);
  });
});

describe("registrationDueState — checkpoint sweep", () => {
  // offset from now → { status, daysRemaining }
  it.each([
    [45, "ok", 45],
    [14, "due-soon", 14],
    [7, "due-soon", 7],
    [1, "due-soon", 1],
    [0.5, "due-soon", 0], // expires later today → still due-soon
    [-0.5, "overdue", 0], // expired earlier today → overdue at daysRemaining 0
    [-30, "overdue", -30],
  ])("expires now%+dd → %s (%d days)", (offset, status, daysRemaining) => {
    expect(registrationDueState({ registrationExpiresAt: daysFromNow(offset) }, NOW)).toEqual({
      status,
      daysRemaining,
    });
  });

  it("honors a custom windowDays", () => {
    expect(
      registrationDueState({ registrationExpiresAt: daysFromNow(8) }, NOW, 7).status
    ).toBe("ok");
    expect(
      registrationDueState({ registrationExpiresAt: daysFromNow(7) }, NOW, 7).status
    ).toBe("due-soon");
  });

  it("RETIRED vehicles never nag (fleet.test.ts covers SOLD)", () => {
    expect(
      registrationDueState({ registrationExpiresAt: daysFromNow(-3), status: "RETIRED" }, NOW)
    ).toEqual({ status: "none", daysRemaining: null });
  });
});

describe("vehicleScheduleSummary — severity ordering + nextDue tie-breaks", () => {
  const vehicle = { currentMileage: 50_000 };

  it("all-ok fleet: status ok, zero counts, earliest due date is nextDue", () => {
    const summary = vehicleScheduleSummary(
      [
        {
          serviceType: "Oil Change",
          ...schedule({ everyMonths: 3, lastServiceDate: new Date("2026-06-20T00:00:00.000Z") }), // due Sep 20
        },
        {
          serviceType: "Coolant Flush",
          ...schedule({ everyMonths: 6, lastServiceDate: new Date("2026-05-01T00:00:00.000Z") }), // due Nov 1
        },
      ],
      vehicle,
      NOW
    );
    expect(summary).toMatchObject({
      status: "ok",
      overdueCount: 0,
      dueSoonCount: 0,
      unknownCount: 0,
    });
    expect(summary.nextDue?.serviceType).toBe("Oil Change");
  });

  it("due-soon outranks unknown for the badge; unknown is excluded from nextDue", () => {
    const summary = vehicleScheduleSummary(
      [
        { serviceType: "Brakes", ...schedule({ everyMiles: 10_000 }) }, // no baseline → unknown
        {
          serviceType: "Inspection",
          ...schedule({ everyMonths: 1, lastServiceDate: new Date("2026-06-20T12:00:00.000Z") }), // due in 4d
        },
      ],
      vehicle,
      NOW
    );
    expect(summary).toMatchObject({ status: "due-soon", dueSoonCount: 1, unknownCount: 1 });
    expect(summary.nextDue?.serviceType).toBe("Inspection");
  });

  it("ALL-unknown: worst status surfaces but nextDue is null (nothing assessable)", () => {
    const summary = vehicleScheduleSummary(
      [
        { serviceType: "Brakes", ...schedule({ everyMiles: 10_000 }) },
        { serviceType: "Belts", ...schedule({ everyMonths: 24 }) },
      ],
      vehicle,
      NOW
    );
    expect(summary).toMatchObject({ status: "unknown", unknownCount: 2, nextDue: null });
  });

  it("among overdues: earliest due date first; a date-less (miles-only) overdue sorts last", () => {
    const summary = vehicleScheduleSummary(
      [
        {
          serviceType: "Later Dated",
          ...schedule({ everyMonths: 1, lastServiceDate: new Date("2026-06-10T00:00:00.000Z") }), // due Jul 10
        },
        {
          serviceType: "Miles Only",
          ...schedule({ everyMiles: 1_000, lastServiceMileage: 48_000 }), // due 49,000 → -1,000
        },
        {
          serviceType: "Earlier Dated",
          ...schedule({ everyMonths: 1, lastServiceDate: new Date("2026-06-01T00:00:00.000Z") }), // due Jul 1
        },
      ],
      vehicle,
      NOW
    );
    expect(summary.overdueCount).toBe(3);
    expect(summary.nextDue?.serviceType).toBe("Earlier Dated");
  });

  it("mixed census: every bucket counted, worst status wins the badge", () => {
    const summary = vehicleScheduleSummary(
      [
        {
          serviceType: "Overdue",
          ...schedule({ everyMonths: 1, lastServiceDate: new Date("2026-06-01T00:00:00.000Z") }),
        },
        {
          serviceType: "Soon (date)",
          ...schedule({ everyMonths: 1, lastServiceDate: new Date("2026-06-20T12:00:00.000Z") }),
        },
        {
          serviceType: "Soon (miles)",
          ...schedule({ everyMiles: 5_000, lastServiceMileage: 45_300 }), // 300 mi remaining
        },
        { serviceType: "Unknown", ...schedule({ everyMiles: 8_000 }) },
        {
          serviceType: "Ok",
          ...schedule({ everyMonths: 12, lastServiceDate: new Date("2026-07-01T00:00:00.000Z") }),
        },
      ],
      vehicle,
      NOW
    );
    expect(summary).toMatchObject({
      status: "overdue",
      overdueCount: 1,
      dueSoonCount: 2,
      unknownCount: 1,
    });
    expect(summary.nextDue?.serviceType).toBe("Overdue");
  });
});

describe("maintenanceDueState — legacy single next-service date (uncovered elsewhere)", () => {
  it.each([
    ["no date recorded", null, "ACTIVE", "none"],
    ["retired vehicles never nag", daysFromNow(-10), "RETIRED", "none"],
    ["one day overdue", daysFromNow(-1), "ACTIVE", "overdue"],
    // Regression: this used whole-day compare (days<0), so a service due
    // 12h ago stayed "due-soon" here while scheduleDueState /
    // registrationDueState (instant compare) already said "overdue".
    // All three paths now flip at the due instant.
    ["due earlier today is overdue (instant compare)", daysFromNow(-0.5), "ACTIVE", "overdue"],
    ["exactly at the 14-day window", daysFromNow(14), "ACTIVE", "due-soon"],
    ["one day past the window", daysFromNow(15), "ACTIVE", "scheduled"],
  ])("%s → %s", (_label, nextServiceDate, status, expected) => {
    expect(maintenanceDueState({ nextServiceDate, status }, NOW)).toBe(expected);
  });
});
