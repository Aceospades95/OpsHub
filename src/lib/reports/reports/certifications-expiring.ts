/**
 * certifications-expiring — certifications that will lapse within 90 days.
 *
 * Focuses on compliance and renewal-cost visibility. Mirrors the
 * certification-expiry-check job's query so scheduled notifications
 * line up with what ends up in the report.
 */

import { db } from "@/lib/db";
import { format } from "date-fns";
import { formatCalendarDate } from "@/lib/dates";
import type { ReportDefinition } from "../types";

function daysBetween(a: Date, b: Date): number {
  return Math.ceil((a.getTime() - b.getTime()) / (1000 * 60 * 60 * 24));
}

export const certificationsExpiring: ReportDefinition = {
  key: "certifications-expiring",
  name: "Certifications expiring soon",
  description:
    "Active and expiring-soon certifications that lapse within 90 days, with renewal cost, owner, point of contact, and sign-off state. Headline numbers include unassigned count and total renewal cost so compliance can prioritize.",
  module: "certifications",
  schedulable: true,

  async run() {
    const now = new Date();
    const horizon = new Date();
    horizon.setDate(horizon.getDate() + 90);

    const certs = await db.certification.findMany({
      where: {
        deletedAt: null,
        status: { in: ["ACTIVE", "EXPIRING_SOON", "PENDING"] },
        expirationDate: { gte: now, lte: horizon },
        // Mirrors the job: a submitted renewal mutes the expiry nagging
        // (and its cost would overstate the outstanding renewal spend).
        renewalSubmittedAt: null,
      },
      include: {
        client: { select: { name: true } },
        assignee: { select: { name: true } },
        pointOfContact: { select: { name: true } },
      },
      orderBy: { expirationDate: "asc" },
    });

    const rows = certs.map((c) => ({
      name: c.name,
      issuingBody: c.issuingBody || "—",
      jurisdictionLevel: c.jurisdictionLevel,
      jurisdictionName: c.jurisdictionName || "—",
      type: c.type,
      status: c.status,
      expirationDate: c.expirationDate,
      daysUntil: c.expirationDate ? daysBetween(c.expirationDate, now) : null,
      renewalCost: c.renewalCost,
      currency: c.currency || "USD",
      assignee: c.assignee?.name || "Unassigned",
      pointOfContact: c.pointOfContact?.name || "—",
      signedOff: c.signedOffAt,
      client: c.client?.name || "Internal",
    }));

    const unassigned = rows.filter((r) => r.assignee === "Unassigned").length;
    const totalRenewalCost = rows.reduce(
      (sum, r) => sum + (r.renewalCost ?? 0),
      0
    );
    const urgent30 = rows.filter(
      (r) => r.daysUntil != null && r.daysUntil <= 30
    ).length;
    const summaryExtras: string[] = [];
    if (urgent30 > 0) summaryExtras.push(`${urgent30} within 30 days`);
    if (unassigned > 0) summaryExtras.push(`${unassigned} unassigned`);
    if (totalRenewalCost > 0) {
      summaryExtras.push(
        `$${Math.round(totalRenewalCost).toLocaleString()} total renewal cost`
      );
    }

    return {
      summary:
        `${rows.length} certification${rows.length === 1 ? "" : "s"} expiring in the next 90 days` +
        (summaryExtras.length > 0 ? ` · ${summaryExtras.join(" · ")}` : "") +
        ".",
      columns: [
        { key: "name", label: "Certification" },
        { key: "issuingBody", label: "Issuer" },
        { key: "jurisdictionLevel", label: "Jurisdiction" },
        { key: "jurisdictionName", label: "Jurisdiction detail" },
        { key: "type", label: "Type" },
        { key: "status", label: "Status" },
        {
          key: "expirationDate",
          label: "Expires",
          // Calendar date (UTC midnight) — server-local format() would
          // shift it a day west of UTC.
          format: (v) => (v instanceof Date ? formatCalendarDate(v, "MMM d, yyyy") : "—"),
        },
        { key: "daysUntil", label: "Days", align: "right" },
        {
          key: "renewalCost",
          label: "Renewal cost",
          align: "right",
          format: (v) => {
            if (typeof v !== "number") return "—";
            return v.toLocaleString(undefined, { maximumFractionDigits: 2 });
          },
        },
        { key: "currency", label: "Cur" },
        { key: "assignee", label: "Assignee" },
        { key: "pointOfContact", label: "Point of contact" },
        {
          key: "signedOff",
          label: "Signed off",
          format: (v) => (v instanceof Date ? format(v, "MMM d, yyyy") : "—"),
        },
        { key: "client", label: "Client" },
      ],
      rows,
      emptyMessage: "No certifications expire in the next 90 days.",
    };
  },
};
