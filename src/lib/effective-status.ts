/**
 * Date-derived display statuses.
 *
 * ContractStatus and CertificationStatus store EXPIRING_SOON / EXPIRED as
 * enum values kept honest only by daily jobs (audit §3.2-5). Views should
 * never trust those two values — they derive the effective status from
 * the dates at render time via these helpers. The stored value still
 * carries the manual lifecycle states (DRAFT, TERMINATED, …).
 */

const MS_PER_DAY = 86_400_000;

/**
 * Whole calendar days from `now` to `date`, on UTC day boundaries —
 * the same framing as formatCalendarDate, where dates are stored at
 * UTC midnight. Replaces date-fns differenceInDays, whose truncation
 * toward zero made an item expiring TOMORROW read as expired whenever
 * less than 24h of clock time remained (e.g. at 2pm against a
 * midnight-stored date).
 */
export function calendarDaysUntil(date: Date, now: Date): number {
  const target = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.round((target - today) / MS_PER_DAY);
}

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
  const days = cert.expirationDate ? calendarDaysUntil(cert.expirationDate, now) : null;
  // Once the expiration date has actually passed, "expired" wins even
  // with a renewal submitted — the org is operating without a valid
  // cert, and a filed renewal that stalled must not hide that forever.
  if (days != null && days <= 0) return "expired";
  if (cert.status === "EXPIRED" && days == null) return "expired";
  // Renewal already submitted (and not yet expired) → we're waiting on
  // the issuing body, so suppress the expiring-soon nag until sign-off
  // clears it.
  if (cert.renewalSubmittedAt) return "renewing";
  if (days != null && days <= (cert.renewalLeadDays || 90)) return "expiring";
  return "active";
}

/** StatusBadge-compatible value per effective bucket. */
export const BUCKET_TO_STATUS: Record<CertBucket, string> = {
  active: "ACTIVE",
  expiring: "EXPIRING_SOON",
  expired: "EXPIRED",
  pending: "PENDING",
  renewing: "RENEWAL_SUBMITTED",
};

/** Stored statuses that describe a manual lifecycle judgment, not a
 * date-derived one — these pass through untouched. */
const MANUAL_CERT_STATUSES = new Set(["SUSPENDED", "REVOKED"]);

/**
 * StatusBadge-ready certification status: SUSPENDED/REVOKED pass
 * through; everything else renders the date-derived bucket. Every
 * surface that shows a certification status (list, detail, reports)
 * routes through this so a stored ACTIVE sitting past its expiration
 * date can never display as active anywhere.
 */
export function certDisplayStatus(
  cert: Parameters<typeof certBucket>[0],
  now: Date
): string {
  if (MANUAL_CERT_STATUSES.has(cert.status)) return cert.status;
  return BUCKET_TO_STATUS[certBucket(cert, now)];
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
    const days = calendarDaysUntil(contract.endDate, now);
    if (days <= 0) return "EXPIRED";
    if (days <= CONTRACT_EXPIRING_WINDOW_DAYS) return "EXPIRING_SOON";
    return "ACTIVE";
  }
  return contract.status;
}
