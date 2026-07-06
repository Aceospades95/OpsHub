/**
 * Date-derived display statuses.
 *
 * ContractStatus and CertificationStatus store EXPIRING_SOON / EXPIRED as
 * enum values kept honest only by daily jobs (audit §3.2-5). Views should
 * never trust those two values — they derive the effective status from
 * the dates at render time via these helpers. The stored value still
 * carries the manual lifecycle states (DRAFT, TERMINATED, …).
 */

import { differenceInDays } from "date-fns";

// ─── Certifications ──────────────────────────────────────────────

export type CertBucket = "active" | "expiring" | "expired" | "pending" | "renewing";

export const CERT_BUCKETS: CertBucket[] = ["active", "expiring", "expired", "pending", "renewing"];

export const CERT_BUCKET_LABELS: Record<CertBucket, string> = {
  active: "Active",
  expiring: "Expiring Soon",
  expired: "Expired",
  pending: "Pending",
  renewing: "Renewal Submitted",
};

/**
 * Effective certification bucket, preferring dates over the stored
 * status. Mirrors the long-standing bucket logic on /certifications —
 * extracted so table views, group-by, and the stat cards all agree.
 */
export function certBucket(
  cert: {
    status: string;
    expirationDate: Date | null;
    renewalLeadDays: number | null;
    /** Optional — older call sites may not select it. */
    renewalSubmittedAt?: Date | null;
  },
  now: Date
): CertBucket {
  if (cert.status === "PENDING") return "pending";
  // Renewal already submitted → we're waiting on the issuing body, so
  // suppress the expiring/expired alarms until sign-off clears it.
  if (cert.renewalSubmittedAt) return "renewing";
  if (cert.expirationDate) {
    const days = differenceInDays(cert.expirationDate, now);
    if (days <= 0) return "expired";
    if (days <= (cert.renewalLeadDays || 90)) return "expiring";
  } else if (cert.status === "EXPIRED") {
    return "expired";
  }
  return "active";
}

// ─── Contracts ────────────────────────────────────────────────────

/** Days-to-end window that counts as "expiring soon" for display. */
const CONTRACT_EXPIRING_WINDOW_DAYS = 60;

/** Stored statuses that describe a manual lifecycle state, not a
 * date-derived one. These always win over date math. */
const MANUAL_CONTRACT_STATUSES = new Set([
  "DRAFT",
  "UNDER_REVIEW",
  "TERMINATED",
  "RENEWED",
]);

/**
 * Effective contract status for display: manual lifecycle states pass
 * through; otherwise the end date decides between EXPIRED,
 * EXPIRING_SOON, and ACTIVE — regardless of whether the daily
 * contract-expiry job has caught up with the stored value.
 */
export function effectiveContractStatus(
  contract: { status: string; endDate: Date | null },
  now: Date
): string {
  if (MANUAL_CONTRACT_STATUSES.has(contract.status)) return contract.status;
  if (contract.endDate) {
    const days = differenceInDays(contract.endDate, now);
    if (days <= 0) return "EXPIRED";
    if (days <= CONTRACT_EXPIRING_WINDOW_DAYS) return "EXPIRING_SOON";
    return "ACTIVE";
  }
  return contract.status;
}
