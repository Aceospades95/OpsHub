/**
 * subcontractor-compliance — surface subcontractors whose insurance is
 * expiring within 60 days, whose MSA isn't on file, or whose compliance
 * status has slipped to PENDING / EXPIRED / NON_COMPLIANT. Lets ops
 * triage paperwork before billing or onboarding hits a wall.
 */

import { db } from "@/lib/db";
import { format } from "date-fns";
import type { ReportDefinition } from "../types";

export const subcontractorCompliance: ReportDefinition = {
  key: "subcontractor-compliance",
  name: "Subcontractor compliance",
  description:
    "Subcontractors with expiring or expired insurance, missing MSA/W-9, or a non-compliant status. Sorted by urgency (expired first) so PMs and AP can clear blockers before billing.",
  module: "subcontractors",
  schedulable: true,

  async run() {
    const sixtyDays = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000);
    const subs = await db.subcontractor.findMany({
      where: {
        status: { not: "ARCHIVED" },
        OR: [
          { complianceStatus: { in: ["PENDING", "EXPIRED", "NON_COMPLIANT"] } },
          { insuranceExpiresAt: { lte: sixtyDays } },
          { msaSignedAt: null },
          { w9OnFile: false },
        ],
      },
      include: {
        accountManager: { select: { name: true } },
        _count: { select: { projects: { where: { status: { in: ["ACTIVE", "PLANNED"] } } } } },
      },
      orderBy: { name: "asc" },
    });

    const now = new Date();
    const rows = subs.map((s) => {
      const insuranceMs = s.insuranceExpiresAt
        ? s.insuranceExpiresAt.getTime() - now.getTime()
        : null;
      const issues: string[] = [];
      if (s.complianceStatus !== "COMPLIANT") issues.push(s.complianceStatus.replace("_", " ").toLowerCase());
      if (!s.msaSignedAt) issues.push("MSA missing");
      if (!s.w9OnFile) issues.push("W-9 missing");
      if (insuranceMs != null && insuranceMs < 0) issues.push("insurance expired");
      else if (insuranceMs != null && insuranceMs < 30 * 24 * 60 * 60 * 1000) issues.push("insurance expiring soon");

      return {
        name: s.name,
        status: s.status,
        complianceStatus: s.complianceStatus,
        insuranceExpiresAt: s.insuranceExpiresAt,
        msaSignedAt: s.msaSignedAt,
        w9: s.w9OnFile ? "Yes" : "No",
        accountManager: s.accountManager?.name || "—",
        activeProjects: s._count.projects,
        issues: issues.join(", "),
        // Sort key — negative ms (already expired) sorts first
        _sortKey: insuranceMs ?? Number.POSITIVE_INFINITY,
      };
    });

    rows.sort((a, b) => a._sortKey - b._sortKey);

    const expiredCount = rows.filter(
      (r) => r.insuranceExpiresAt && r.insuranceExpiresAt < now,
    ).length;
    const expiringCount = rows.filter(
      (r) =>
        r.insuranceExpiresAt &&
        r.insuranceExpiresAt > now &&
        r.insuranceExpiresAt.getTime() - now.getTime() < 30 * 24 * 60 * 60 * 1000,
    ).length;

    return {
      summary:
        `${rows.length} subcontractor${rows.length === 1 ? "" : "s"} need attention` +
        (expiredCount > 0 ? ` · ${expiredCount} insurance expired` : "") +
        (expiringCount > 0 ? ` · ${expiringCount} expiring in 30 days` : "") +
        ".",
      columns: [
        { key: "name", label: "Subcontractor" },
        { key: "status", label: "Status" },
        { key: "complianceStatus", label: "Compliance" },
        {
          key: "insuranceExpiresAt",
          label: "Insurance Expires",
          format: (v) => (v instanceof Date ? format(v, "MMM d, yyyy") : "—"),
        },
        {
          key: "msaSignedAt",
          label: "MSA Signed",
          format: (v) => (v instanceof Date ? format(v, "MMM d, yyyy") : "—"),
        },
        { key: "w9", label: "W-9" },
        { key: "activeProjects", label: "Active Projects", align: "right" },
        { key: "accountManager", label: "Owner" },
        { key: "issues", label: "Issues" },
      ],
      rows,
      emptyMessage: "All subcontractors are compliant.",
    };
  },
};
