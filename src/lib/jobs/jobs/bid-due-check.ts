/**
 * bid-due-check
 *
 * Notifies when an open (pre-submission) bid's response deadline is
 * within 7 days or overdue. Recipients: the bid's owner plus active
 * admins + managers, each greeted by name. Deduped via
 * BidOpportunity.dueNotifiedFor — one notification per dueDate value;
 * changing the deadline re-arms it (same pattern as
 * vehicle-maintenance-check).
 */

import { db } from "@/lib/db";
import { log } from "@/lib/log";
import { notify } from "@/lib/notifications";
import { absoluteUrl } from "@/lib/url";
import { differenceInDays } from "date-fns";
import { formatCalendarDate } from "@/lib/dates";
import { PRE_SUBMISSION_STATUSES, BID_DUE_WINDOW_DAYS } from "@/lib/bids";
import { shouldRunDaily } from "../gating";
import { getJobParams } from "../params";
import type { JobDefinition } from "../types";

export const bidDueCheck: JobDefinition = {
  key: "bid-due-check",
  name: "Bid deadline check",
  description:
    "Notifies the bid owner and admins/managers when an open bid's response is due soon (window configurable below) or overdue",
  schedule: "Daily",
  paramsSchema: [
    {
      key: "dueSoonDays",
      label: "Due-soon window (days)",
      type: "number",
      min: 1,
      defaultValue: BID_DUE_WINDOW_DAYS,
      help: "Notify when an open bid's response deadline is within this many days",
    },
  ],

  async handler() {
    if (!(await shouldRunDaily("bid-due-check"))) {
      return { status: "skipped", output: "Already ran today", processed: 0 };
    }
    const { dueSoonDays } = await getJobParams("bid-due-check", {
      dueSoonDays: BID_DUE_WINDOW_DAYS,
    });
    const now = new Date();
    const horizon = new Date(now.getTime() + dueSoonDays * 24 * 60 * 60 * 1000);

    const bids = await db.bidOpportunity.findMany({
      where: {
        deletedAt: null,
        status: { in: PRE_SUBMISSION_STATUSES },
        dueDate: { not: null, lte: horizon },
      },
      include: { owner: { select: { id: true, name: true } } },
    });

    if (bids.length === 0) {
      return { output: "No bids in the deadline window", processed: 0 };
    }

    const managers = await db.user.findMany({
      where: { isActive: true, role: { in: ["ADMIN", "MANAGER"] } },
      select: { id: true, name: true },
    });

    let notified = 0;
    for (const bid of bids) {
      if (!bid.dueDate) continue;
      // Already notified for this exact deadline — re-arms when the
      // date changes.
      if (bid.dueNotifiedFor && bid.dueNotifiedFor.getTime() === bid.dueDate.getTime()) {
        continue;
      }

      const days = differenceInDays(bid.dueDate, now);
      const title =
        days < 0
          ? `Bid response overdue: ${bid.title}`
          : `Bid due in ${days} day${days === 1 ? "" : "s"}: ${bid.title}`;
      const body = [bid.agency, bid.solicitationNumber].filter(Boolean).join(" · ") || bid.title;
      const dueDay = formatCalendarDate(bid.dueDate, "MMMM d, yyyy");

      const recipients = new Map(managers.map((m) => [m.id, m.name]));
      if (bid.owner) recipients.set(bid.owner.id, bid.owner.name);

      let delivered = 0;
      for (const [recipientId, recipientName] of Array.from(recipients.entries())) {
        try {
          await notify({
            recipientId,
            type: "bid-due-soon",
            title,
            body,
            href: `/bids/${bid.id}`,
            entityType: "bid",
            entityId: bid.id,
            email: {
              templateKey: "notification",
              data: {
                recipientName,
                heading: title,
                body: `The response for "${bid.title}" is due ${dueDay}. Submit it (and mark the bid Submitted in OpsHub) or move the bid to No Bid to stop the reminders.`,
                cta: { label: "Open bid", url: absoluteUrl(`/bids/${bid.id}`) },
              },
            },
          });
          delivered += 1;
        } catch (err) {
          log.error("jobs.bidDue", "Notify failed", err, { bidId: bid.id, recipientId });
        }
      }

      if (delivered > 0) {
        notified += 1;
        await db.bidOpportunity.update({
          where: { id: bid.id },
          data: { dueNotifiedFor: bid.dueDate },
        });
      }
    }

    return {
      output: `Checked ${bids.length} bid${bids.length === 1 ? "" : "s"}, notified on ${notified}`,
      processed: notified,
    };
  },
};
