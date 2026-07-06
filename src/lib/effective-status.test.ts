import { describe, it, expect } from "vitest";
import { certBucket, effectiveContractStatus } from "./effective-status";

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

  it("falls back to stored EXPIRED when there is no date", () => {
    expect(certBucket({ status: "EXPIRED", expirationDate: null, renewalLeadDays: null }, NOW)).toBe(
      "expired"
    );
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
});
