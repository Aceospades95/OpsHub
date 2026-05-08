/**
 * contracts-expiring — contracts with an end or renewal date in the next
 * 60 days. Designed for account managers and legal to have a single view
 * of what's coming up for negotiation.
 *
 * Mirrors the query in src/lib/jobs/jobs/contract-expiry-check.ts, but
 * returns a tabular result rather than notifying.
 */

import { db } from "@/lib/db";
import { format } from "date-fns";
import type { ReportDefinition } from "../types";

function daysBetween(a: Date, b: Date): number {
  return Math.ceil((a.getTime() - b.getTime()) / (1000 * 60 * 60 * 24));
}

export const contractsExpiring: ReportDefinition = {
  key: "contracts-expiring",
  name: "Contracts expiring soon",
  description:
    "Active contracts with an end or renewal date in the next 60 days, ordered by soonest. Includes contract value, account manager, auto-renew flag, and notice period so legal can triage in one view.",
  module: "contracts",
  schedulable: true,

  async run() {
    const now = new Date();
    const horizon = new Date();
    horizon.setDate(horizon.getDate() + 60);

    const contracts = await db.contract.findMany({
      where: {
        deletedAt: null,
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
        const daysUntil = daysBetween(soonest, now);
        return {
          title: c.title,
          contractNumber: c.contractNumber || "—",
          client: c.client?.name || "—",
          status: c.status,
          value: c.value,
          currency: c.currency,
          accountManager: c.client?.accountManager?.name || "—",
          soonestDate: soonest,
          daysUntil,
          // Days remaining minus the notice period — a negative number
          // means the notice window has already opened, which is the
          // signal legal cares about most.
          noticeBufferDays:
            c.noticePeriodDays != null ? daysUntil - c.noticePeriodDays : null,
          autoRenew: c.autoRenew,
        };
      })
      .filter((r): r is NonNullable<typeof r> => r !== null)
      .sort((a, b) => a.daysUntil - b.daysUntil);

    // Headline summary: total value, urgent count, and how many are in
    // their notice window. Adds signal beyond the bare row count.
    const totalValue = rows.reduce((sum, r) => sum + (r.value ?? 0), 0);
    const urgent30 = rows.filter((r) => r.daysUntil <= 30).length;
    const inNoticeWindow = rows.filter(
      (r) => r.noticeBufferDays != null && r.noticeBufferDays <= 0
    ).length;
    const summaryExtras: string[] = [];
    if (totalValue > 0) {
      summaryExtras.push(
        `$${Math.round(totalValue).toLocaleString()} total value`
      );
    }
    if (urgent30 > 0) summaryExtras.push(`${urgent30} within 30 days`);
    if (inNoticeWindow > 0)
      summaryExtras.push(`${inNoticeWindow} past notice deadline`);

    return {
      summary:
        `${rows.length} contract${rows.length === 1 ? "" : "s"} expiring in the next 60 days` +
        (summaryExtras.length > 0 ? ` · ${summaryExtras.join(" · ")}` : "") +
        ".",
      columns: [
        { key: "title", label: "Contract" },
        { key: "contractNumber", label: "Number" },
        { key: "client", label: "Client" },
        { key: "status", label: "Status" },
        {
          key: "value",
          label: "Value",
          align: "right",
          format: (v) => {
            if (typeof v !== "number") return "—";
            return v.toLocaleString(undefined, { maximumFractionDigits: 2 });
          },
        },
        { key: "currency", label: "Cur" },
        { key: "accountManager", label: "Account manager" },
        {
          key: "soonestDate",
          label: "Date",
          format: (v) => (v instanceof Date ? format(v, "MMM d, yyyy") : "—"),
        },
        { key: "daysUntil", label: "Days", align: "right" },
        {
          key: "noticeBufferDays",
          label: "Notice buffer",
          align: "right",
          format: (v) => {
            if (typeof v !== "number") return "—";
            if (v <= 0) return `${v}d (overdue)`;
            return `${v}d`;
          },
        },
        {
          key: "autoRenew",
          label: "Auto-renew",
          format: (v) => (v ? "Yes" : "No"),
        },
      ],
      rows,
      emptyMessage: "No contracts expire in the next 60 days.",
    };
  },
};
