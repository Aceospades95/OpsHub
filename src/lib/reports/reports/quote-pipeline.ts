/**
 * quote-pipeline — open quotes grouped by status, with totals.
 *
 * Sales-facing snapshot of the quoting pipeline. Surfaces what's still
 * sitting in DRAFT, what's gone out and is waiting on a client, what's
 * been won, and the pipeline value at each stage.
 *
 * Mirrors what an account manager would otherwise have to assemble by
 * filtering /quotes manually, with the same numbers that show up on
 * the totals card.
 */

import { db } from "@/lib/db";
import { format } from "date-fns";
import type { ReportDefinition } from "../types";

export const quotePipeline: ReportDefinition = {
  key: "quote-pipeline",
  name: "Quote pipeline",
  description:
    "All quotes that aren't archived, with status, client, total, and assignee. Grouped totals appear in the summary so you can see the pipeline value per stage at a glance.",
  module: "quotes",
  schedulable: true,

  async run() {
    const quotes = await db.quote.findMany({
      where: {
        status: { in: ["DRAFT", "SENT", "VIEWED", "ACCEPTED", "REJECTED", "EXPIRED", "REVISED"] },
      },
      include: {
        client: { select: { name: true } },
        assignedTo: { select: { name: true } },
      },
      orderBy: [{ status: "asc" }, { updatedAt: "desc" }],
    });

    const rows = quotes.map((q) => ({
      quoteNumber: q.quoteNumber,
      title: q.title,
      client: q.client?.name || "—",
      status: q.status,
      total: q.total,
      currency: q.currency,
      assignee: q.assignedTo?.name || "Unassigned",
      validUntil: q.validUntil,
      sentAt: q.sentAt,
      updatedAt: q.updatedAt,
    }));

    // Totals per status — drives the headline summary so the email
    // body tells you "$X open · $Y accepted" without having to scan
    // the whole table.
    const byStatus = new Map<string, { count: number; total: number }>();
    for (const r of rows) {
      const bucket = byStatus.get(r.status) ?? { count: 0, total: 0 };
      bucket.count += 1;
      bucket.total += r.total ?? 0;
      byStatus.set(r.status, bucket);
    }
    const summaryParts = Array.from(byStatus.entries()).map(
      ([s, { count, total }]) =>
        `${count} ${s.toLowerCase()} ($${Math.round(total).toLocaleString()})`
    );

    return {
      summary:
        rows.length === 0
          ? "No active quotes."
          : `${rows.length} quote${rows.length === 1 ? "" : "s"} · ${summaryParts.join(" · ")}`,
      columns: [
        { key: "quoteNumber", label: "Number" },
        { key: "title", label: "Title" },
        { key: "client", label: "Client" },
        { key: "status", label: "Status" },
        {
          key: "total",
          label: "Total",
          align: "right",
          format: (v) => {
            if (typeof v !== "number") return "—";
            return `$${v.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
          },
        },
        { key: "currency", label: "Cur" },
        { key: "assignee", label: "Assignee" },
        {
          key: "validUntil",
          label: "Valid until",
          format: (v) => (v instanceof Date ? format(v, "MMM d, yyyy") : "—"),
        },
        {
          key: "sentAt",
          label: "Sent",
          format: (v) => (v instanceof Date ? format(v, "MMM d, yyyy") : "—"),
        },
        {
          key: "updatedAt",
          label: "Updated",
          format: (v) => (v instanceof Date ? format(v, "MMM d, yyyy") : "—"),
        },
      ],
      rows,
      emptyMessage: "No active quotes in the pipeline.",
    };
  },
};
