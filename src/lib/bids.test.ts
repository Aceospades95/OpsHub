import { describe, it, expect } from "vitest";
import {
  bidDueState,
  bidStaleness,
  bidWaitingDays,
  OPEN_BID_STATUSES,
  BID_STATUSES,
  BID_STALE_AFTER_DAYS,
} from "./bids";

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

describe("bidStaleness", () => {
  it("current when not past due, or without a due date", () => {
    expect(bidStaleness({ status: "PREPARING", dueDate: daysFromNow(3) }, NOW)).toBe("current");
    expect(bidStaleness({ status: "IDENTIFIED", dueDate: null }, NOW)).toBe("current");
    // Due today (less than a full day's difference) is not overdue yet.
    expect(bidStaleness({ status: "PREPARING", dueDate: NOW }, NOW)).toBe("current");
  });

  it("overdue when past due by up to the stale threshold", () => {
    expect(bidStaleness({ status: "IDENTIFIED", dueDate: daysFromNow(-1) }, NOW)).toBe("overdue");
    expect(bidStaleness({ status: "PREPARING", dueDate: daysFromNow(-15) }, NOW)).toBe("overdue");
  });

  it("boundary: exactly 30 full days past due is still overdue; 31 is stale", () => {
    expect(
      bidStaleness({ status: "PREPARING", dueDate: daysFromNow(-BID_STALE_AFTER_DAYS) }, NOW)
    ).toBe("overdue");
    expect(
      bidStaleness({ status: "PREPARING", dueDate: daysFromNow(-(BID_STALE_AFTER_DAYS + 1)) }, NOW)
    ).toBe("stale");
  });

  it("boundary: 30 days + a few hours is still 30 full days → overdue", () => {
    const dueDate = new Date(daysFromNow(-BID_STALE_AFTER_DAYS).getTime() - 6 * 60 * 60 * 1000);
    expect(bidStaleness({ status: "IDENTIFIED", dueDate }, NOW)).toBe("overdue");
  });

  it("stale for long-past IDENTIFIED/PREPARING rows (the 2025 zombie case)", () => {
    expect(bidStaleness({ status: "IDENTIFIED", dueDate: daysFromNow(-400) }, NOW)).toBe("stale");
    expect(bidStaleness({ status: "PREPARING", dueDate: daysFromNow(-90) }, NOW)).toBe("stale");
  });

  it("never overdue/stale once submitted or closed, however old the due date", () => {
    for (const status of ["SUBMITTED", "WON", "LOST", "NO_BID", "STALE"] as const) {
      expect(bidStaleness({ status, dueDate: daysFromNow(-400) }, NOW)).toBe("current");
    }
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
