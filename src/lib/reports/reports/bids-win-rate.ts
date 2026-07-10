/**
 * bids-win-rate — pipeline performance per procurement portal.
 *
 * Answers "which registrations actually produce work": decided bids
 * (won / lost / no-bid / stale) grouped by source portal with win rate
 * and dollar totals, plus the open count so a hot portal with nothing
 * decided yet still shows up.
 */

import { db } from "@/lib/db";
import type { ReportDefinition } from "../types";
import { OPEN_BID_STATUSES } from "@/lib/bids";

export const bidsWinRate: ReportDefinition = {
  key: "bids-win-rate",
  name: "Bid win rate by portal",
  description:
    "Per procurement portal: open pipeline, submitted/decided counts, win rate, and won value — which registrations are worth renewing.",
  module: "bids",
  schedulable: true,

  async run() {
    const bids = await db.bidOpportunity.findMany({
      where: { deletedAt: null },
      select: {
        status: true,
        estimatedValue: true,
        portal: { select: { id: true, name: true } },
      },
    });

    interface Bucket {
      portal: string;
      open: number;
      won: number;
      lost: number;
      noBid: number;
      stale: number;
      wonValue: number;
    }
    const buckets = new Map<string, Bucket>();
    for (const bid of bids) {
      const key = bid.portal?.name ?? "No portal / referral";
      let b = buckets.get(key);
      if (!b) {
        b = { portal: key, open: 0, won: 0, lost: 0, noBid: 0, stale: 0, wonValue: 0 };
        buckets.set(key, b);
      }
      if (OPEN_BID_STATUSES.includes(bid.status)) b.open += 1;
      else if (bid.status === "WON") {
        b.won += 1;
        b.wonValue += bid.estimatedValue ?? 0;
      } else if (bid.status === "LOST") b.lost += 1;
      else if (bid.status === "NO_BID") b.noBid += 1;
      else if (bid.status === "STALE") b.stale += 1;
    }

    const rows = Array.from(buckets.values())
      .map((b) => {
        // Win rate over real decisions — no-bids were our choice and
        // stale bids never got a verdict, so neither belongs in the
        // denominator.
        const decided = b.won + b.lost;
        return {
          ...b,
          winRate: decided > 0 ? `${Math.round((b.won / decided) * 100)}%` : "—",
        };
      })
      .sort((a, b) => b.won - a.won || b.open - a.open);

    const totalWon = rows.reduce((sum, r) => sum + r.won, 0);
    const totalDecided = rows.reduce((sum, r) => sum + r.won + r.lost, 0);
    const totalWonValue = rows.reduce((sum, r) => sum + r.wonValue, 0);

    return {
      summary:
        `${totalWon}/${totalDecided} decided bids won` +
        (totalDecided > 0 ? ` (${Math.round((totalWon / totalDecided) * 100)}%)` : "") +
        (totalWonValue > 0 ? ` · $${Math.round(totalWonValue).toLocaleString()} won value` : "") +
        ".",
      columns: [
        { key: "portal", label: "Portal" },
        { key: "open", label: "Open", align: "right" },
        { key: "won", label: "Won", align: "right" },
        { key: "lost", label: "Not awarded", align: "right" },
        { key: "noBid", label: "No bid", align: "right" },
        { key: "stale", label: "Stale", align: "right" },
        { key: "winRate", label: "Win rate", align: "right" },
        {
          key: "wonValue",
          label: "Won value",
          align: "right",
          format: (v) =>
            typeof v === "number" && v > 0 ? v.toLocaleString(undefined, { maximumFractionDigits: 0 }) : "—",
        },
      ],
      rows,
      emptyMessage: "No bids tracked yet.",
    };
  },
};
