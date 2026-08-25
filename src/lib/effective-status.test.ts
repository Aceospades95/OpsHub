import { describe, it, expect } from "vitest";
import { certBucket, certDisplayStatus, effectiveContractStatus } from "./effective-status";

const NOW = new Date("2026-07-01T12:00:00Z");
const daysFromNow = (d: number) => new Date(NOW.getTime() + d * 24 * 60 * 60 * 1000);

describe("certBucket", () => {
  it("PENDING wins over everything", () => {
    expect(
      certBucket({ status: "PENDING", expirationDate: daysFromNow(-5), renewalLeadDays: 90 }, NOW)
    ).toBe("pending");
  });

  it("derives expired from a past expiration date even when stored ACTIVE", () => {
    expect(
      certBucket({ status: "ACTIVE", expirationDate: daysFromNow(-1), renewalLeadDays: 90 }, NOW)
    ).toBe("expired");
  });

  it("derives expiring inside the lead window", () => {
    expect(
      certBucket({ status: "ACTIVE", expirationDate: daysFromNow(30), renewalLeadDays: 90 }, NOW)
    ).toBe("expiring");
  });

  it("active outside the lead window", () => {
    expect(
      certBucket({ status: "ACTIVE", expirationDate: daysFromNow(120), renewalLeadDays: 90 }, NOW)
    ).toBe("active");
  });

  it("renewal submitted mutes the expiring-soon nag before expiration", () => {
    expect(
      certBucket(
        {
          status: "ACTIVE",
          expirationDate: daysFromNow(30),
          renewalLeadDays: 90,
          renewalSubmittedAt: daysFromNow(-10),
        },
        NOW
      )
    ).toBe("renewing");
  });

  it("expired wins over renewal submitted once the date passes (backstop)", () => {
    expect(
      certBucket(
        {
          status: "ACTIVE",
          expirationDate: daysFromNow(-3),
          renewalLeadDays: 90,
          renewalSubmittedAt: daysFromNow(-10),
        },
        NOW
      )
    ).toBe("expired");
  });

  it("PENDING still wins over renewal submitted", () => {
    expect(
      certBucket(
        {
          status: "PENDING",
          expirationDate: null,
          renewalLeadDays: null,
          renewalSubmittedAt: daysFromNow(-1),
        },
        NOW
      )
    ).toBe("pending");
  });

  it("falls back to stored EXPIRED when there is no date", () => {
    expect(certBucket({ status: "EXPIRED", expirationDate: null, renewalLeadDays: null }, NOW)).toBe(
      "expired"
    );
  });

  // Regression: dates are stored at UTC midnight, so at NOW=12:00Z a
  // cert expiring TOMORROW is less than 24h away on the clock.
  // date-fns differenceInDays truncated that to 0 and mislabeled it
  // expired a day early; calendar-day math must say "expiring".
  it("a cert expiring tomorrow (UTC-midnight date, <24h away) is expiring, not expired", () => {
    expect(
      certBucket(
        {
          status: "ACTIVE",
          expirationDate: new Date("2026-07-02T00:00:00Z"),
          renewalLeadDays: 90,
        },
        NOW
      )
    ).toBe("expiring");
  });

  it("a cert whose expiration date is today counts as expired", () => {
    expect(
      certBucket(
        {
          status: "ACTIVE",
          expirationDate: new Date("2026-07-01T00:00:00Z"),
          renewalLeadDays: 90,
        },
        NOW
      )
    ).toBe("expired");
  });
});

describe("certDisplayStatus", () => {
  it("maps the derived bucket to a StatusBadge value (stored ACTIVE past date → EXPIRED)", () => {
    expect(
      certDisplayStatus(
        { status: "ACTIVE", expirationDate: daysFromNow(-30), renewalLeadDays: 90 },
        NOW
      )
    ).toBe("EXPIRED");
  });

  it("passes manual SUSPENDED / REVOKED judgments through untouched", () => {
    for (const status of ["SUSPENDED", "REVOKED"]) {
      expect(
        certDisplayStatus({ status, expirationDate: daysFromNow(-30), renewalLeadDays: 90 }, NOW)
      ).toBe(status);
    }
  });

  it("shows RENEWAL_SUBMITTED while a renewal is in flight", () => {
    expect(
      certDisplayStatus(
        {
          status: "ACTIVE",
          expirationDate: daysFromNow(20),
          renewalLeadDays: 90,
          renewalSubmittedAt: daysFromNow(-5),
        },
        NOW
      )
    ).toBe("RENEWAL_SUBMITTED");
  });
});

describe("effectiveContractStatus", () => {
  it("manual lifecycle states pass through untouched", () => {
    for (const status of ["DRAFT", "UNDER_REVIEW", "TERMINATED", "RENEWED"]) {
      expect(effectiveContractStatus({ status, endDate: daysFromNow(-100) }, NOW)).toBe(status);
    }
  });

  it("derives EXPIRED from a past end date even when stored ACTIVE", () => {
    expect(effectiveContractStatus({ status: "ACTIVE", endDate: daysFromNow(-1) }, NOW)).toBe(
      "EXPIRED"
    );
  });

  it("derives EXPIRING_SOON inside the 60-day window", () => {
    expect(effectiveContractStatus({ status: "ACTIVE", endDate: daysFromNow(30) }, NOW)).toBe(
      "EXPIRING_SOON"
    );
  });

  it("derives ACTIVE past the window even when stored EXPIRING_SOON is stale", () => {
    expect(
      effectiveContractStatus({ status: "EXPIRING_SOON", endDate: daysFromNow(120) }, NOW)
    ).toBe("ACTIVE");
  });

  it("keeps the stored status when there is no end date", () => {
    expect(effectiveContractStatus({ status: "ACTIVE", endDate: null }, NOW)).toBe("ACTIVE");
  });

  // Same truncation regression as certs: ending tomorrow is not expired.
  it("a contract ending tomorrow (UTC-midnight date, <24h away) is EXPIRING_SOON, not EXPIRED", () => {
    expect(
      effectiveContractStatus(
        { status: "ACTIVE", endDate: new Date("2026-07-02T00:00:00Z") },
        NOW
      )
    ).toBe("EXPIRING_SOON");
  });
});
