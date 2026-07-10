import { describe, it, expect } from "vitest";
import { bidDueState, bidWaitingDays, OPEN_BID_STATUSES, BID_STATUSES } from "./bids";

const NOW = new Date("2026-07-08T12:00:00Z");
const daysFromNow = (d: number) => new Date(NOW.getTime() + d * 24 * 60 * 60 * 1000);

describe("bidDueState", () => {
  it("flags overdue pre-submission bids", () => {
    expect(bidDueState({ status: "PREPARING", dueDate: daysFromNow(-1) }, NOW)).toBe("overdue");
    expect(bidDueState({ status: "IDENTIFIED", dueDate: daysFromNow(-10) }, NOW)).toBe("overdue");
  });

  it("flags due-soon inside the 7-day window", () => {
    expect(bidDueState({ status: "PREPARING", dueDate: daysFromNow(3) }, NOW)).toBe("due-soon");
    expect(bidDueState({ status: "IDENTIFIED", dueDate: daysFromNow(7) }, NOW)).toBe("due-soon");
  });

  it("scheduled outside the window", () => {
    expect(bidDueState({ status: "PREPARING", dueDate: daysFromNow(30) }, NOW)).toBe("scheduled");
  });

  it("never nags once submitted or closed", () => {
    for (const status of ["SUBMITTED", "WON", "LOST", "NO_BID", "STALE"] as const) {
      expect(bidDueState({ status, dueDate: daysFromNow(-5) }, NOW)).toBe("none");
    }
  });

  it("none without a due date", () => {
    expect(bidDueState({ status: "PREPARING", dueDate: null }, NOW)).toBe("none");
  });
});

describe("bidWaitingDays", () => {
  it("counts days since submission for SUBMITTED bids", () => {
    expect(
      bidWaitingDays({ status: "SUBMITTED", submittedAt: daysFromNow(-45), dueDate: null }, NOW)
    ).toBe(45);
  });

  it("falls back to the due date when submittedAt is missing", () => {
    expect(
      bidWaitingDays({ status: "SUBMITTED", submittedAt: null, dueDate: daysFromNow(-10) }, NOW)
    ).toBe(10);
  });

  it("null for non-submitted stages or missing dates", () => {
    expect(
      bidWaitingDays({ status: "WON", submittedAt: daysFromNow(-45), dueDate: null }, NOW)
    ).toBeNull();
    expect(bidWaitingDays({ status: "SUBMITTED", submittedAt: null, dueDate: null }, NOW)).toBeNull();
  });
});

describe("stage vocabulary", () => {
  it("open stages are the first three pipeline stages", () => {
    expect(BID_STATUSES.slice(0, 3)).toEqual(OPEN_BID_STATUSES);
  });
});
