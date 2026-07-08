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
