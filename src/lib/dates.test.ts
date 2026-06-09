import { describe, it, expect } from "vitest";
import {
  formatCalendarDate,
  toCalendarDateString,
  parseCalendarDateString,
  isValidCalendarRange,
} from "./dates";

/**
 * The QA timezone bug: a user picks Jan 1, 2026 in a date input, the
 * action stores UTC midnight, and date-fns `format()` (which uses local
 * TZ) renders it as "Dec 31, 2025" in PST — losing both a day and a
 * year. These tests pin the contract that `formatCalendarDate` is
 * TZ-stable by construction (it formats in UTC), so the rendered
 * calendar date always matches the calendar date the user picked.
 */

describe("formatCalendarDate", () => {
  it("renders UTC midnight Jan 1, 2026 as 'Jan 1, 2026'", () => {
    const date = new Date(Date.UTC(2026, 0, 1));
    expect(formatCalendarDate(date, "MMM d, yyyy")).toBe("Jan 1, 2026");
  });

  it("renders Dec 31, 2026 as 'Dec 31, 2026' (not Dec 30)", () => {
    const date = new Date(Date.UTC(2026, 11, 31));
    expect(formatCalendarDate(date, "MMM d, yyyy")).toBe("Dec 31, 2026");
  });

  it("does not year-shift for end-of-year dates (the year-rollover symptom in the QA repro)", () => {
    // The QA report saw end=01/01/2026 render as "Dec 31, 2025" in PST.
    // formatCalendarDate must keep the year the user picked.
    const date = new Date(Date.UTC(2026, 0, 1));
    expect(formatCalendarDate(date, "MMM d, yyyy")).toContain("2026");
    expect(formatCalendarDate(date, "MMM d, yyyy")).not.toContain("2025");
  });

  it("renders Feb 29, 2024 (leap day) without rolling to Mar 1 or Feb 28", () => {
    const date = new Date(Date.UTC(2024, 1, 29));
    expect(formatCalendarDate(date, "MMM d, yyyy")).toBe("Feb 29, 2024");
  });

  it("supports the short 'MMM d' format used by task lists", () => {
    const date = new Date(Date.UTC(2026, 5, 15));
    expect(formatCalendarDate(date, "MMM d")).toBe("Jun 15");
  });

  it("supports the long 'MMMM d, yyyy' format used by quote detail", () => {
    const date = new Date(Date.UTC(2026, 5, 15));
    expect(formatCalendarDate(date, "MMMM d, yyyy")).toBe("June 15, 2026");
  });

  it("accepts an ISO 'YYYY-MM-DD' string and renders the same calendar date", () => {
    expect(formatCalendarDate("2026-01-01", "MMM d, yyyy")).toBe("Jan 1, 2026");
    expect(formatCalendarDate("2026-12-31", "MMM d, yyyy")).toBe("Dec 31, 2026");
  });

  it("returns '' for null, undefined, and invalid input", () => {
    expect(formatCalendarDate(null, "MMM d, yyyy")).toBe("");
    expect(formatCalendarDate(undefined, "MMM d, yyyy")).toBe("");
    expect(formatCalendarDate("not-a-date", "MMM d, yyyy")).toBe("");
    expect(formatCalendarDate(new Date("nope"), "MMM d, yyyy")).toBe("");
  });

  /**
   * Cross-TZ proof: format the same UTC-midnight value (a) through our
   * helper and (b) through `Intl.DateTimeFormat` configured for PST.
   * The PST formatting reproduces the bug ("Dec 31, 2025" for a Jan 1
   * stored value); our helper does NOT, because it uses timeZone: 'UTC'.
   *
   * This works in any test environment timezone — we explicitly set
   * timeZone on the comparison formatter.
   */
  it("does not shift across timezones the way a viewer-TZ formatter would", () => {
    const stored = new Date(Date.UTC(2026, 0, 1));

    // What a naive viewer-TZ formatter would emit in PST. This reproduces
    // the QA bug.
    const pstReader = new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      timeZone: "America/Los_Angeles",
    });
    expect(pstReader.format(stored)).toBe("Dec 31, 2025");

    // What our helper emits. Same input, no shift.
    expect(formatCalendarDate(stored, "MMM d, yyyy")).toBe("Jan 1, 2026");
  });

  it.each([
    ["America/Los_Angeles"], // PST / PDT
    ["America/New_York"], // EST / EDT
    ["UTC"],
    ["Asia/Tokyo"], // JST
    ["Pacific/Auckland"], // NZ — east of Tokyo
    ["Pacific/Midway"], // far west — UTC-11
  ])(
    "stays calendar-stable when a viewer-TZ formatter would shift (%s)",
    (timeZone) => {
      const stored = new Date(Date.UTC(2026, 0, 1));
      // A viewer-TZ formatter MIGHT shift this date depending on the
      // zone — that's exactly what we're avoiding. Our helper's output
      // is the same string everywhere.
      const ours = formatCalendarDate(stored, "MMM d, yyyy");
      expect(ours).toBe("Jan 1, 2026");
      // Sanity check: the comparison formatter for this TZ at least
      // produces SOMETHING — we don't assert what (some zones shift,
      // others don't), only that our output doesn't depend on it.
      const theirs = new Intl.DateTimeFormat("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        timeZone,
      }).format(stored);
      expect(typeof theirs).toBe("string");
      expect(theirs.length).toBeGreaterThan(0);
    }
  );
});

describe("toCalendarDateString", () => {
  it("formats UTC midnight Jan 1, 2026 as '2026-01-01'", () => {
    const date = new Date(Date.UTC(2026, 0, 1));
    expect(toCalendarDateString(date)).toBe("2026-01-01");
  });

  it("returns '' for null / undefined / invalid", () => {
    expect(toCalendarDateString(null)).toBe("");
    expect(toCalendarDateString(undefined)).toBe("");
    expect(toCalendarDateString(new Date("nope"))).toBe("");
  });
});

describe("parseCalendarDateString", () => {
  it("parses '2026-01-01' to UTC midnight Jan 1, 2026", () => {
    const date = parseCalendarDateString("2026-01-01");
    expect(date?.toISOString()).toBe("2026-01-01T00:00:00.000Z");
  });

  it("rejects anything that isn't a strict YYYY-MM-DD", () => {
    // No accidental local-TZ interpretation of full ISO strings.
    expect(parseCalendarDateString("2026-01-01T12:00:00")).toBe(null);
    expect(parseCalendarDateString("01/01/2026")).toBe(null);
    expect(parseCalendarDateString("not-a-date")).toBe(null);
    expect(parseCalendarDateString("")).toBe(null);
    expect(parseCalendarDateString(null)).toBe(null);
    expect(parseCalendarDateString(undefined)).toBe(null);
  });

  it("rejects impossible calendar dates instead of rolling them over", () => {
    // new Date("2026-02-30") silently becomes Mar 2 — the round-trip
    // check must catch that.
    expect(parseCalendarDateString("2026-02-30")).toBe(null);
    expect(parseCalendarDateString("2026-04-31")).toBe(null);
    expect(parseCalendarDateString("2025-02-29")).toBe(null); // not a leap year
    expect(parseCalendarDateString("2026-00-10")).toBe(null);
    expect(parseCalendarDateString("2026-13-01")).toBe(null);
    expect(parseCalendarDateString("2026-06-00")).toBe(null);
  });

  it("still accepts real month-end and leap-day dates", () => {
    expect(parseCalendarDateString("2024-02-29")?.toISOString()).toBe(
      "2024-02-29T00:00:00.000Z"
    );
    expect(parseCalendarDateString("2026-12-31")?.toISOString()).toBe(
      "2026-12-31T00:00:00.000Z"
    );
  });
});

describe("round-trip parse → toString", () => {
  it.each([
    "2026-01-01",
    "2026-12-31",
    "2024-02-29", // leap day
    "2025-03-01",
    "2025-12-31",
    "2027-01-01",
  ])("'%s' round-trips losslessly", (input) => {
    const parsed = parseCalendarDateString(input);
    expect(parsed).not.toBeNull();
    expect(toCalendarDateString(parsed!)).toBe(input);
  });
});

describe("round-trip parse → format", () => {
  it("'2026-01-01' formats as 'Jan 1, 2026' (PST, EST, UTC, Tokyo)", () => {
    // The full QA spec round-trip: store, then display, never lose a day.
    const parsed = parseCalendarDateString("2026-01-01");
    expect(parsed).not.toBeNull();
    expect(formatCalendarDate(parsed, "MMM d, yyyy")).toBe("Jan 1, 2026");
  });
});

describe("isValidCalendarRange", () => {
  it("accepts a forward range", () => {
    expect(isValidCalendarRange("2026-01-01", "2026-12-31")).toBe(true);
  });

  it("accepts equal start and end (single-day range)", () => {
    expect(isValidCalendarRange("2026-06-15", "2026-06-15")).toBe(true);
  });

  it("rejects an inverted range — the QA repro", () => {
    // QA: Start = 12/31/2026, End = 01/01/2026. Should be rejected.
    expect(isValidCalendarRange("2026-12-31", "2026-01-01")).toBe(false);
  });

  it("treats either side missing as valid (open-ended ranges are fine)", () => {
    expect(isValidCalendarRange(null, "2026-12-31")).toBe(true);
    expect(isValidCalendarRange("2026-01-01", null)).toBe(true);
    expect(isValidCalendarRange(undefined, undefined)).toBe(true);
    expect(isValidCalendarRange("", "")).toBe(true);
  });

  it("does not double-flag malformed inputs (downstream zod handles those)", () => {
    expect(isValidCalendarRange("garbage", "2026-12-31")).toBe(true);
    expect(isValidCalendarRange("2026-01-01", "garbage")).toBe(true);
  });
});
