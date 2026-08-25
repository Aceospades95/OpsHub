import { differenceInDays } from "date-fns";
import type { BidStatus } from "@prisma/client";

/**
 * Bid pipeline helpers — stage vocabulary and date-derived display
 * state, same philosophy as lib/fleet and lib/effective-status.
 */

/** Pipeline order: the first three are the open stages. */
export const BID_STATUSES: BidStatus[] = [
  "IDENTIFIED",
  "PREPARING",
  "SUBMITTED",
  "WON",
  "LOST",
  "NO_BID",
  "STALE",
];

export const BID_STATUS_LABELS: Record<BidStatus, string> = {
  IDENTIFIED: "Identified",
  PREPARING: "Preparing",
  SUBMITTED: "Submitted",
  WON: "Won",
  LOST: "Not Awarded",
  NO_BID: "No Bid",
  STALE: "Stale",
};

/** Stages where the opportunity is still live in the pipeline. */
export const OPEN_BID_STATUSES: BidStatus[] = ["IDENTIFIED", "PREPARING", "SUBMITTED"];

/** Stages before the response goes in — the due date still matters. */
export const PRE_SUBMISSION_STATUSES: BidStatus[] = ["IDENTIFIED", "PREPARING"];

/** Days-to-deadline window that counts as "due soon". */
export const BID_DUE_WINDOW_DAYS = 7;

/** A SUBMITTED bid quiet for this long gets a "check on this" nudge. */
export const BID_STALE_HINT_DAYS = 60;

/**
 * A pre-submission bid whose due date is more than this many full days
 * in the past has died quietly — it stops counting as "overdue" (a
 * to-do) and reads as "stale" (needs a verdict: mark STALE or revive).
 */
export const BID_STALE_AFTER_DAYS = 30;

export type BidDueState = "overdue" | "due-soon" | "scheduled" | "none";

/**
 * Date-derived deadline state. Only pre-submission stages nag — once
 * the response is in (or the bid is closed out) the due date is
 * history, not a to-do.
 */
export function bidDueState(
  bid: { status: BidStatus; dueDate: Date | null },
  now: Date
): BidDueState {
  if (!PRE_SUBMISSION_STATUSES.includes(bid.status)) return "none";
  if (!bid.dueDate) return "none";
  const days = differenceInDays(bid.dueDate, now);
  if (days < 0) return "overdue";
  if (days <= BID_DUE_WINDOW_DAYS) return "due-soon";
  return "scheduled";
}

export type BidStaleness = "current" | "overdue" | "stale";

/**
 * Freshness of a still-open (IDENTIFIED/PREPARING) bid relative to its
 * due date:
 *
 *   current  not past due (or no due date, or past the pre-submission
 *            stages — SUBMITTED and closed bids are never overdue).
 *   overdue  due date is past by ≤ BID_STALE_AFTER_DAYS full days —
 *            a real "chase this now" item.
 *   stale    due date is past by MORE than BID_STALE_AFTER_DAYS full
 *            days while the bid never left IDENTIFIED/PREPARING — it
 *            died quietly and should be marked STALE or revived, not
 *            counted as overdue forever.
 *
 * Boundary: exactly BID_STALE_AFTER_DAYS full days past due is still
 * "overdue"; strictly more flips to "stale".
 */
export function bidStaleness(
  bid: { status: BidStatus; dueDate: Date | null },
  now: Date
): BidStaleness {
  if (bidDueState(bid, now) !== "overdue") return "current";
  // bidDueState guaranteed a pre-submission stage with a past dueDate.
  const daysPast = differenceInDays(now, bid.dueDate as Date);
  return daysPast > BID_STALE_AFTER_DAYS ? "stale" : "overdue";
}

/**
 * Days a SUBMITTED bid has been waiting on the buyer (from
 * submittedAt, falling back to the due date). Null when not waiting.
 */
export function bidWaitingDays(
  bid: { status: BidStatus; submittedAt: Date | null; dueDate: Date | null },
  now: Date
): number | null {
  if (bid.status !== "SUBMITTED") return null;
  const since = bid.submittedAt ?? bid.dueDate;
  if (!since) return null;
  return Math.max(0, differenceInDays(now, since));
}
