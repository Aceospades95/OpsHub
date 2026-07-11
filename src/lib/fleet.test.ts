import { describe, it, expect } from "vitest";
import {
  scheduleDueState,
  vehicleScheduleSummary,
  registrationDueState,
  scheduleCadenceLabel,
} from "./fleet";

const NOW = new Date("2026-07-08T12:00:00Z");
const daysFromNow = (d: number) => new Date(NOW.getTime() + d * 24 * 60 * 60 * 1000);

const schedule = (over: Partial<Parameters<typeof scheduleDueState>[0]> = {}) => ({
  everyMonths: null,
  everyMiles: null,
  lastServiceDate: null,
  lastServiceMileage: null,
  ...over,
});

describe("scheduleDueState — time-only schedules", () => {
  it("ok when the next due date is beyond the window", () => {
    // Last done Jun 1, every 3 months → due Sep 1 (~55 days out).
    const state = scheduleDueState(
      schedule({ everyMonths: 3, lastServiceDate: new Date("2026-06-01T00:00:00Z") }),
      { currentMileage: 40_000 },
      NOW
    );
    expect(state.status).toBe("ok");
    expect(state.dueDate).toEqual(new Date("2026-09-01T00:00:00Z"));
    expect(state.dueMileage).toBeNull();
    expect(state.milesRemaining).toBeNull();
    expect(state.daysRemaining).toBe(54);
  });

  it("overdue once the due date passes", () => {
    // Last done Apr 1, every 3 months → due Jul 1 (a week ago).
    const state = scheduleDueState(
      schedule({ everyMonths: 3, lastServiceDate: new Date("2026-04-01T00:00:00Z") }),
      { currentMileage: null },
      NOW
    );
    expect(state.status).toBe("overdue");
    expect(state.daysRemaining).toBeLessThan(0);
  });
});

describe("scheduleDueState — miles-only schedules", () => {
  it("ok with plenty of miles remaining", () => {
    const state = scheduleDueState(
      schedule({ everyMiles: 4_000, lastServiceMileage: 41_200 }),
      { currentMileage: 42_000 },
      NOW
    );
    expect(state.status).toBe("ok");
    expect(state.dueDate).toBeNull();
    expect(state.dueMileage).toBe(45_200);
    expect(state.milesRemaining).toBe(3_200);
    expect(state.daysRemaining).toBeNull();
  });

  it("overdue at exactly the due mileage", () => {
    const state = scheduleDueState(
      schedule({ everyMiles: 4_000, lastServiceMileage: 41_200 }),
      { currentMileage: 45_200 },
      NOW
    );
    expect(state.status).toBe("overdue");
    expect(state.milesRemaining).toBe(0);
  });

  it("overdue past the due mileage", () => {
    const state = scheduleDueState(
      schedule({ everyMiles: 4_000, lastServiceMileage: 41_200 }),
      { currentMileage: 46_000 },
      NOW
    );
    expect(state.status).toBe("overdue");
    expect(state.milesRemaining).toBe(-800);
  });
});

describe("scheduleDueState — both bounds", () => {
  it("miles trips first even when the date is comfortably out", () => {
    // Date bound due in ~2 months, but only 300 miles remain.
    const state = scheduleDueState(
      schedule({
        everyMonths: 3,
        everyMiles: 4_000,
        lastServiceDate: new Date("2026-06-01T00:00:00Z"),
        lastServiceMileage: 41_200,
      }),
      { currentMileage: 44_900 },
      NOW
    );
    expect(state.status).toBe("due-soon");
    expect(state.milesRemaining).toBe(300);
    expect(state.daysRemaining).toBe(54);
  });

  it("mileage overdue wins even when the date bound is fine", () => {
    const state = scheduleDueState(
      schedule({
        everyMonths: 6,
        everyMiles: 4_000,
        lastServiceDate: new Date("2026-06-01T00:00:00Z"),
        lastServiceMileage: 41_200,
      }),
      { currentMileage: 45_300 },
      NOW
    );
    expect(state.status).toBe("overdue");
  });

  it("date trips first when miles are plentiful", () => {
    const state = scheduleDueState(
      schedule({
        everyMonths: 1,
        everyMiles: 10_000,
        lastServiceDate: new Date("2026-06-15T00:00:00Z"),
        lastServiceMileage: 41_200,
      }),
      { currentMileage: 41_500 },
      NOW
    );
    // Due Jul 15 — 6 days out.
    expect(state.status).toBe("due-soon");
    expect(state.daysRemaining).toBe(6);
    expect(state.milesRemaining).toBe(9_700);
  });
});

describe("scheduleDueState — unknown baselines", () => {
  it("unknown when the cadence has no last-service baseline", () => {
    const state = scheduleDueState(
      schedule({ everyMonths: 3, everyMiles: 4_000 }),
      { currentMileage: 42_000 },
      NOW
    );
    expect(state.status).toBe("unknown");
    expect(state.dueDate).toBeNull();
    expect(state.dueMileage).toBeNull();
  });

  it("unknown when only a mileage bound exists but the vehicle has no odometer reading", () => {
    const state = scheduleDueState(
      schedule({ everyMiles: 4_000, lastServiceMileage: 41_200 }),
      { currentMileage: null },
      NOW
    );
    expect(state.status).toBe("unknown");
    expect(state.dueMileage).toBe(45_200);
    expect(state.milesRemaining).toBeNull();
  });

  it("a date baseline keeps the schedule assessable even without mileage data", () => {
    const state = scheduleDueState(
      schedule({
        everyMonths: 12,
        everyMiles: 4_000,
        lastServiceDate: new Date("2026-07-01T00:00:00Z"),
      }),
      { currentMileage: null },
      NOW
    );
    expect(state.status).toBe("ok");
  });
});

describe("scheduleDueState — due-soon boundaries", () => {
  const timeOnly = (lastServiceDate: Date) =>
    schedule({ everyMonths: 1, lastServiceDate });

  it("due-soon at exactly the day window, ok one day beyond", () => {
    // everyMonths: 1 from Jun 22 → due Jul 22, exactly 14 days from NOW.
    const at14 = scheduleDueState(timeOnly(new Date("2026-06-22T12:00:00Z")), { currentMileage: null }, NOW);
    expect(at14.daysRemaining).toBe(14);
    expect(at14.status).toBe("due-soon");

    const at15 = scheduleDueState(timeOnly(new Date("2026-06-23T12:00:00Z")), { currentMileage: null }, NOW);
    expect(at15.daysRemaining).toBe(15);
    expect(at15.status).toBe("ok");
  });

  it("due-soon at exactly the mile window, ok one mile beyond", () => {
    const at500 = scheduleDueState(
      schedule({ everyMiles: 4_000, lastServiceMileage: 40_000 }),
      { currentMileage: 43_500 },
      NOW
    );
    expect(at500.milesRemaining).toBe(500);
    expect(at500.status).toBe("due-soon");

    const at501 = scheduleDueState(
      schedule({ everyMiles: 4_000, lastServiceMileage: 40_000 }),
      { currentMileage: 43_499 },
      NOW
    );
    expect(at501.milesRemaining).toBe(501);
    expect(at501.status).toBe("ok");
  });

  it("honors custom due-soon windows", () => {
    const state = scheduleDueState(
      timeOnly(new Date("2026-06-22T12:00:00Z")),
      { currentMileage: null },
      NOW,
      { dueSoonDays: 7 }
    );
    expect(state.daysRemaining).toBe(14);
    expect(state.status).toBe("ok");

    const miles = scheduleDueState(
      schedule({ everyMiles: 4_000, lastServiceMileage: 40_000 }),
      { currentMileage: 43_500 },
      NOW,
      { dueSoonMiles: 250 }
    );
    expect(miles.status).toBe("ok");
  });
});

describe("vehicleScheduleSummary", () => {
  const oil = schedule({
    everyMonths: 3,
    everyMiles: 4_000,
    lastServiceDate: new Date("2026-03-02T00:00:00Z"),
    lastServiceMileage: 41_200,
  });
  const tires = schedule({
    everyMonths: 6,
    lastServiceDate: new Date("2026-05-01T00:00:00Z"),
  });
  const brakes = schedule({ everyMiles: 20_000 }); // no baseline

  it("rolls up the worst status and counts", () => {
    // Oil due Jun 2 (overdue); tires due Nov 1 (ok); brakes unknown.
    const summary = vehicleScheduleSummary(
      [
        { serviceType: "Oil Change", ...oil },
        { serviceType: "Tire Rotation", ...tires },
        { serviceType: "Brake Pads", ...brakes },
      ],
      { currentMileage: 44_000 },
      NOW
    );
    expect(summary.status).toBe("overdue");
    expect(summary.overdueCount).toBe(1);
    expect(summary.dueSoonCount).toBe(0);
    expect(summary.unknownCount).toBe(1);
    expect(summary.nextDue?.serviceType).toBe("Oil Change");
  });

  it("unknown outranks ok so missing baselines surface", () => {
    const summary = vehicleScheduleSummary(
      [
        { serviceType: "Tire Rotation", ...tires },
        { serviceType: "Brake Pads", ...brakes },
      ],
      { currentMileage: 44_000 },
      NOW
    );
    expect(summary.status).toBe("unknown");
    expect(summary.nextDue?.serviceType).toBe("Tire Rotation");
  });

  it("picks the most urgent item as next due", () => {
    // Both due-soon: inspection in 10 days, oil only 200 miles away
    // but dated further out → date-ranked item with the earlier due
    // date wins within the same severity.
    const summary = vehicleScheduleSummary(
      [
        {
          serviceType: "Inspection",
          ...schedule({ everyMonths: 1, lastServiceDate: new Date("2026-06-18T00:00:00Z") }),
        },
        {
          serviceType: "Oil Change",
          ...schedule({ everyMiles: 4_000, lastServiceMileage: 40_200 }),
        },
      ],
      { currentMileage: 44_000 },
      NOW
    );
    expect(summary.status).toBe("due-soon");
    expect(summary.dueSoonCount).toBe(2);
    // Inspection has a due DATE; the mileage-only item has none (sorts last).
    expect(summary.nextDue?.serviceType).toBe("Inspection");
  });

  it("none for vehicles with no schedules or retired/sold vehicles", () => {
    expect(vehicleScheduleSummary([], { currentMileage: null }, NOW).status).toBe("none");
    const summary = vehicleScheduleSummary(
      [{ serviceType: "Oil Change", ...oil }],
      { currentMileage: 44_000, status: "RETIRED" },
      NOW
    );
    expect(summary.status).toBe("none");
    expect(summary.nextDue).toBeNull();
  });
});

describe("registrationDueState", () => {
  it("none without an expiry date", () => {
    expect(registrationDueState({ registrationExpiresAt: null }, NOW).status).toBe("none");
  });

  it("ok outside the 30-day window, due-soon at the boundary", () => {
    expect(
      registrationDueState({ registrationExpiresAt: daysFromNow(31) }, NOW).status
    ).toBe("ok");
    expect(
      registrationDueState({ registrationExpiresAt: daysFromNow(30) }, NOW).status
    ).toBe("due-soon");
  });

  it("overdue past the expiry date, with negative days remaining", () => {
    const state = registrationDueState({ registrationExpiresAt: daysFromNow(-3) }, NOW);
    expect(state.status).toBe("overdue");
    expect(state.daysRemaining).toBe(-3);
  });

  it("never nags retired/sold vehicles", () => {
    expect(
      registrationDueState(
        { registrationExpiresAt: daysFromNow(-3), status: "SOLD" },
        NOW
      ).status
    ).toBe("none");
  });
});

describe("scheduleCadenceLabel", () => {
  it("formats both bounds, one bound, and none", () => {
    expect(scheduleCadenceLabel({ everyMonths: 3, everyMiles: 4_000 })).toBe(
      "every 3 mo / 4,000 mi"
    );
    expect(scheduleCadenceLabel({ everyMonths: 3, everyMiles: null })).toBe("every 3 mo");
    expect(scheduleCadenceLabel({ everyMonths: null, everyMiles: 5_000 })).toBe(
      "every 5,000 mi"
    );
    expect(scheduleCadenceLabel({ everyMonths: null, everyMiles: null })).toBe("—");
  });
});
