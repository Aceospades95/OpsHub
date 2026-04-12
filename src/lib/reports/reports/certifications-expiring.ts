/**
 * certifications-expiring — certifications that will lapse within 90 days.
 *
 * Focuses on compliance and renewal-cost visibility. Mirrors the
 * certification-expiry-check job's query so scheduled notifications
 * line up with what ends up in the report.
 */

import { db } from "@/lib/db";
import type { ReportDefinition } from "../types";

function daysBetween(a: Date, b: Date): number {
  return Math.ceil((a.getTime() - b.getTime()) / (1000 * 60 * 60 * 24));
}

export const certificationsExpiring: ReportDefinition = {
  key: "certifications-expiring",
  name: "Certifications expiring soon",
  description:
    "Active and expiring-soon certifications that lapse within 90 days, with renewal cost and responsible owner.",
  module: "certifications",
  schedulable: true,

  async run() {
    const now = new Date();
    const horizon = new Date();
    horizon.setDate(horizon.getDate() + 90);

    const certs = await db.certification.findMany({
      where: {
        status: { in: ["ACTIVE", "EXPIRING_SOON", "PENDING"] },
        expirationDate: { gte: now, lte: horizon },
      },
      include: {
        client: { select: { name: true } },
        assignee: { select: { name: true } },
      },
      orderBy: { expirationDate: "asc" },
    });

    const rows = certs.map((c) => ({
      name: c.name,
      issuingBody: c.issuingBody || "—",
      type: c.type,
      status: c.status,
      expirationDate: c.expirationDate,
      daysUntil: c.expirationDate ? daysBetween(c.expirationDate, now) : null,
      renewalCost: c.renewalCost
        ? `${c.currency || "USD"} ${c.renewalCost.toLocaleString()}`
        : "—",
      assignee: c.assignee?.name || "Unassigned",
      client: c.client?.name || "Internal",
    }));

    return {
      summary: `${rows.length} certification${rows.length === 1 ? "" : "s"} expiring in the next 90 days.`,
      columns: [
        { key: "name", label: "Certification" },
        { key: "issuingBody", label: "Issuer" },
        { key: "type", label: "Type" },
        { key: "status", label: "Status" },
        { key: "expirationDate", label: "Expires" },
        { key: "daysUntil", label: "Days", align: "right" },
        { key: "renewalCost", label: "Renewal cost", align: "right" },
        { key: "assignee", label: "Owner" },
        { key: "client", label: "Client" },
      ],
      rows,
      emptyMessage: "No certifications expire in the next 90 days.",
    };
  },
};
