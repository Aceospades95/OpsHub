import { describe, it, expect } from "vitest";
import { resolveScheduledFor, describeTiming } from "./timing";

describe("resolveScheduledFor", () => {
  const start = new Date("2026-06-01T00:00:00Z");

  it("ON_ENTRY runs at instance start", () => {
    const at = resolveScheduledFor({
      timingType: "ON_ENTRY",
      timingValue: 0,
      instanceStartDate: start,
    });
    expect(at?.toISOString()).toBe("2026-06-01T00:00:00.000Z");
  });

  it("DAYS_AFTER_START with positive value adds days", () => {
    const at = resolveScheduledFor({
      timingType: "DAYS_AFTER_START",
      timingValue: 7,
      instanceStartDate: start,
    });
    expect(at?.toISOString()).toBe("2026-06-08T00:00:00.000Z");
  });

  it("DAYS_AFTER_START with negative value runs before start", () => {
    const at = resolveScheduledFor({
      timingType: "DAYS_AFTER_START",
      timingValue: -3,
      instanceStartDate: start,
    });
    expect(at?.toISOString()).toBe("2026-05-29T00:00:00.000Z");
  });

  it("DAYS_BEFORE_TARGET subtracts days from the target date", () => {
    const target = new Date("2026-12-31T00:00:00Z");
    const at = resolveScheduledFor({
      timingType: "DAYS_BEFORE_TARGET",
      timingValue: 7,
      instanceStartDate: start,
      instanceTargetDate: target,
    });
    expect(at?.toISOString()).toBe("2026-12-24T00:00:00.000Z");
  });

  it("DAYS_BEFORE_TARGET returns null when target is missing", () => {
    const at = resolveScheduledFor({
      timingType: "DAYS_BEFORE_TARGET",
      timingValue: 7,
      instanceStartDate: start,
      instanceTargetDate: null,
    });
    expect(at).toBeNull();
  });

  it("AFTER_STEP returns the predecessor's completion timestamp", () => {
    const completed = new Date("2026-06-05T12:34:56Z");
    const at = resolveScheduledFor({
      timingType: "AFTER_STEP",
      timingValue: 0,
      instanceStartDate: start,
      predecessorCompletedAt: completed,
    });
    expect(at?.toISOString()).toBe(completed.toISOString());
  });

  it("AFTER_STEP returns null when predecessor hasn't completed", () => {
    const at = resolveScheduledFor({
      timingType: "AFTER_STEP",
      timingValue: 0,
      instanceStartDate: start,
      predecessorCompletedAt: null,
    });
    expect(at).toBeNull();
  });
});

describe("describeTiming", () => {
  it("formats ON_ENTRY plainly", () => {
    expect(describeTiming("ON_ENTRY", 0, false)).toBe("On entry");
  });

  it("formats Day +0 specially", () => {
    expect(describeTiming("DAYS_AFTER_START", 0, false)).toBe("Day 0 (start)");
  });

  it("formats positive day offsets with +", () => {
    expect(describeTiming("DAYS_AFTER_START", 7, false)).toBe("Day +7");
  });

  it("formats negative day offsets with the minus sign", () => {
    expect(describeTiming("DAYS_AFTER_START", -7, false)).toBe("Day −7");
  });

  it("pluralizes target-relative descriptions", () => {
    expect(describeTiming("DAYS_BEFORE_TARGET", 1, false)).toBe(
      "1 day before target"
    );
    expect(describeTiming("DAYS_BEFORE_TARGET", 7, false)).toBe(
      "7 days before target"
    );
  });

  it("flags AFTER_STEP without a predecessor as unset", () => {
    expect(describeTiming("AFTER_STEP", 0, false)).toBe("After step (unset)");
    expect(describeTiming("AFTER_STEP", 0, true)).toBe("After previous step");
  });
});
