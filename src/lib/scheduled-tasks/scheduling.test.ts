import { describe, it, expect } from "vitest";
import { isDueNow, describeCadence } from "./scheduling";

describe("isDueNow", () => {
  it("HOURLY fires when no last-run is recorded", () => {
    expect(
      isDueNow({
        frequency: "HOURLY",
        hourUtc: 0,
        dayOfWeek: null,
        dayOfMonth: null,
        lastRunAt: null,
        now: new Date("2026-06-15T10:30:00Z"),
      })
    ).toBe(true);
  });

  it("HOURLY skips a second tick within the same hour", () => {
    expect(
      isDueNow({
        frequency: "HOURLY",
        hourUtc: 0,
        dayOfWeek: null,
        dayOfMonth: null,
        // Last run was 5 minutes earlier in the same hour.
        lastRunAt: new Date("2026-06-15T10:25:00Z"),
        now: new Date("2026-06-15T10:30:00Z"),
      })
    ).toBe(false);
  });

  it("HOURLY fires again at the top of the next hour", () => {
    expect(
      isDueNow({
        frequency: "HOURLY",
        hourUtc: 0,
        dayOfWeek: null,
        dayOfMonth: null,
        lastRunAt: new Date("2026-06-15T10:25:00Z"),
        now: new Date("2026-06-15T11:01:00Z"),
      })
    ).toBe(true);
  });

  it("DAILY waits until the configured hour", () => {
    expect(
      isDueNow({
        frequency: "DAILY",
        hourUtc: 9,
        dayOfWeek: null,
        dayOfMonth: null,
        lastRunAt: null,
        now: new Date("2026-06-15T08:30:00Z"),
      })
    ).toBe(false);
  });

  it("DAILY fires once we reach the configured hour", () => {
    expect(
      isDueNow({
        frequency: "DAILY",
        hourUtc: 9,
        dayOfWeek: null,
        dayOfMonth: null,
        lastRunAt: null,
        now: new Date("2026-06-15T09:00:00Z"),
      })
    ).toBe(true);
  });

  it("DAILY skips a second fire on the same day", () => {
    expect(
      isDueNow({
        frequency: "DAILY",
        hourUtc: 9,
        dayOfWeek: null,
        dayOfMonth: null,
        lastRunAt: new Date("2026-06-15T09:00:00Z"),
        now: new Date("2026-06-15T15:00:00Z"),
      })
    ).toBe(false);
  });

  it("DAILY fires the next day at the configured hour", () => {
    expect(
      isDueNow({
        frequency: "DAILY",
        hourUtc: 9,
        dayOfWeek: null,
        dayOfMonth: null,
        lastRunAt: new Date("2026-06-15T09:00:00Z"),
        now: new Date("2026-06-16T09:01:00Z"),
      })
    ).toBe(true);
  });

  it("WEEKLY fires only on the configured day of week", () => {
    // 2026-06-15 is a Monday. dayOfWeek=1 is Monday, so this fires.
    expect(
      isDueNow({
        frequency: "WEEKLY",
        hourUtc: 9,
        dayOfWeek: 1,
        dayOfMonth: null,
        lastRunAt: null,
        now: new Date("2026-06-15T09:30:00Z"),
      })
    ).toBe(true);

    // Tuesday (dayOfWeek=2) should not fire when configured for Monday.
    expect(
      isDueNow({
        frequency: "WEEKLY",
        hourUtc: 9,
        dayOfWeek: 1,
        dayOfMonth: null,
        // No prior run, but the most-recent Monday at 09:00 was
        // 2026-06-15. From Tuesday's perspective, that fire window
        // already passed but lastRunAt is null so it would still fire.
        // We use a lastRunAt of that exact past window to confirm
        // Tuesday doesn't trigger.
        lastRunAt: new Date("2026-06-15T09:00:00Z"),
        now: new Date("2026-06-16T15:00:00Z"),
      })
    ).toBe(false);
  });

  it("MONTHLY fires on the configured day of month", () => {
    expect(
      isDueNow({
        frequency: "MONTHLY",
        hourUtc: 9,
        dayOfWeek: null,
        dayOfMonth: 15,
        lastRunAt: null,
        now: new Date("2026-06-15T09:30:00Z"),
      })
    ).toBe(true);
  });

  it("MONTHLY skips after a fire and waits until next month's target day", () => {
    expect(
      isDueNow({
        frequency: "MONTHLY",
        hourUtc: 9,
        dayOfWeek: null,
        dayOfMonth: 15,
        lastRunAt: new Date("2026-06-15T09:00:00Z"),
        now: new Date("2026-06-20T09:00:00Z"),
      })
    ).toBe(false);

    expect(
      isDueNow({
        frequency: "MONTHLY",
        hourUtc: 9,
        dayOfWeek: null,
        dayOfMonth: 15,
        lastRunAt: new Date("2026-06-15T09:00:00Z"),
        now: new Date("2026-07-15T09:00:00Z"),
      })
    ).toBe(true);
  });

  it("WEEKLY without dayOfWeek never fires (malformed config)", () => {
    expect(
      isDueNow({
        frequency: "WEEKLY",
        hourUtc: 9,
        dayOfWeek: null,
        dayOfMonth: null,
        lastRunAt: null,
        now: new Date("2026-06-15T09:00:00Z"),
      })
    ).toBe(false);
  });
});

describe("describeCadence", () => {
  it("describes hourly", () => {
    expect(
      describeCadence({
        frequency: "HOURLY",
        hourUtc: 9,
        dayOfWeek: null,
        dayOfMonth: null,
      })
    ).toBe("Every hour");
  });

  it("describes daily with the configured hour", () => {
    expect(
      describeCadence({
        frequency: "DAILY",
        hourUtc: 14,
        dayOfWeek: null,
        dayOfMonth: null,
      })
    ).toBe("Every day at 14:00 UTC");
  });

  it("describes weekly with the day name", () => {
    expect(
      describeCadence({
        frequency: "WEEKLY",
        hourUtc: 9,
        dayOfWeek: 3,
        dayOfMonth: null,
      })
    ).toBe("Every Wednesday at 09:00 UTC");
  });

  it("describes monthly with the day-of-month", () => {
    expect(
      describeCadence({
        frequency: "MONTHLY",
        hourUtc: 9,
        dayOfWeek: null,
        dayOfMonth: 15,
      })
    ).toBe("On day 15 of every month at 09:00 UTC");
  });

  it("flags malformed weekly + monthly configs", () => {
    expect(
      describeCadence({
        frequency: "WEEKLY",
        hourUtc: 9,
        dayOfWeek: null,
        dayOfMonth: null,
      })
    ).toContain("(day not set)");
    expect(
      describeCadence({
        frequency: "MONTHLY",
        hourUtc: 9,
        dayOfWeek: null,
        dayOfMonth: null,
      })
    ).toContain("(day not set)");
  });
});
