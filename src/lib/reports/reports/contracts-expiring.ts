/**
 * contracts-expiring — contracts with an end or renewal date in the next
 * 60 days. Designed for account managers and legal to have a single view
 * of what's coming up for negotiation.
 *
 * Mirrors the query in src/lib/jobs/jobs/contract-expiry-check.ts, but
 * returns a tabular result rather than notifying.
 */

import { db } from "@/lib/db";
import type { ReportDefinition } from "../types";

function daysBetween(a: Date, b: Date): number {
  return Math.ceil((a.getTime() - b.getTime()) / (1000 * 60 * 60 * 24));
}

export const contractsExpiring: ReportDefinition = {
  key: "contracts-expiring",
  name: "Contracts expiring soon",
  description:
    "Active contracts with an end or renewal date in the next 60 days, ordered by soonest.",
  module: "contracts",
  schedulable: true,

  async run() {
    const now = new Date();
    const horizon = new Date();
    horizon.setDate(horizon.getDate() + 60);

    const contracts = await db.contract.findMany({
      where: {
        status: { in: ["ACTIVE", "EXPIRING_SOON", "UNDER_REVIEW"] },
        OR: [
          { endDate: { gte: now, lte: horizon } },
          { renewalDate: { gte: now, lte: horizon } },
        ],
      },
      include: {
        client: {
          select: {
            name: true,
            accountManager: { select: { name: true } },
          },
        },
      },
    });

    // Normalize into "soonest of end/renewal" so the table sorts correctly
    const rows = contracts
      .map((c) => {
        const dates = [c.endDate, c.renewalDate].filter(
          (d): d is Date => d !== null
        );
        if (dates.length === 0) return null;
        const soonest = dates.reduce((a, b) => (a < b ? a : b));
        return {
          title: c.title,
          client: c.client?.name || "—",
          status: c.status,
          value: c.value ? `${c.currency || "USD"} ${c.value.toLocaleString()}` : "—",
          accountManager: c.client?.accountManager?.name || "—",
          soonestDate: soonest,
          daysUntil: daysBetween(soonest, now),
          autoRenew: c.autoRenew,
        };
      })
      .filter((r): r is NonNullable<typeof r> => r !== null)
      .sort((a, b) => a.daysUntil - b.daysUntil);

    return {
      summary: `${rows.length} contract${rows.length === 1 ? "" : "s"} expiring in the next 60 days.`,
      columns: [
        { key: "title", label: "Contract" },
        { key: "client", label: "Client" },
        { key: "status", label: "Status" },
        { key: "value", label: "Value", align: "right" },
        { key: "accountManager", label: "Account manager" },
        { key: "soonestDate", label: "Date" },
        { key: "daysUntil", label: "Days", align: "right" },
        { key: "autoRenew", label: "Auto-renew" },
      ],
      rows,
      emptyMessage: "No contracts expire in the next 60 days.",
    };
  },
};
