/**
 * partnership-pipeline — partnerships ranked by attributed referral value
 * with active project counts, agreement status, and renewal risk. Used by
 * partnerships leadership to see which relationships are paying off and
 * which agreements need attention.
 */

import { db } from "@/lib/db";
import { format } from "date-fns";
import type { ReportDefinition } from "../types";

export const partnershipPipeline: ReportDefinition = {
  key: "partnership-pipeline",
  name: "Partnership pipeline",
  description:
    "Active and prospect partnerships with attributed referral value, project count by role (referrer / co-delivery / etc.), and a flag for agreements expiring in the next 60 days.",
  module: "partnerships",
  schedulable: true,

  async run() {
    const partners = await db.partnership.findMany({
      where: { status: { in: ["ACTIVE", "PROSPECT"] }, deletedAt: null },
      include: {
        relationshipOwner: { select: { name: true } },
        projects: { select: { role: true, referralValue: true } },
      },
      orderBy: { name: "asc" },
    });

    const now = new Date();
    const sixtyDays = new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000);

    const rows = partners.map((p) => {
      const referralValue = p.projects
        .filter((pp) => pp.role === "REFERRER")
        .reduce((acc, pp) => acc + (pp.referralValue || 0), 0);

      const counts = p.projects.reduce<Record<string, number>>((acc, pp) => {
        acc[pp.role] = (acc[pp.role] || 0) + 1;
        return acc;
      }, {});

      const agreementExpired = p.agreementExpiresAt && p.agreementExpiresAt < now;
      const agreementLapsing =
        !agreementExpired && p.agreementExpiresAt && p.agreementExpiresAt < sixtyDays;
      const flag = agreementExpired
        ? "Agreement expired"
        : agreementLapsing
          ? "Renewal due"
          : "";

      return {
        name: p.name,
        status: p.status,
        type: p.type,
        tier: p.tier || "—",
        owner: p.relationshipOwner?.name || "—",
        projects: p.projects.length,
        referrerProjects: counts.REFERRER || 0,
        coDeliveryProjects: counts.CO_DELIVERY || 0,
        referralValue,
        agreementExpiresAt: p.agreementExpiresAt,
        flag,
      };
    });

    rows.sort((a, b) => b.referralValue - a.referralValue);

    const totalReferral = rows.reduce((acc, r) => acc + r.referralValue, 0);
    const activeCount = rows.filter((r) => r.status === "ACTIVE").length;
    const flaggedCount = rows.filter((r) => r.flag).length;

    return {
      summary:
        `${rows.length} partnership${rows.length === 1 ? "" : "s"} in pipeline · ${activeCount} active` +
        (totalReferral > 0
          ? ` · ${totalReferral.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 })} attributed referral value`
          : "") +
        (flaggedCount > 0 ? ` · ${flaggedCount} agreement risk` : "") +
        ".",
      columns: [
        { key: "name", label: "Partner" },
        { key: "status", label: "Status" },
        { key: "type", label: "Type" },
        { key: "tier", label: "Tier" },
        { key: "owner", label: "Owner" },
        { key: "projects", label: "Projects", align: "right" },
        { key: "referrerProjects", label: "Referrals", align: "right" },
        { key: "coDeliveryProjects", label: "Co-delivery", align: "right" },
        {
          key: "referralValue",
          label: "Referral $",
          align: "right",
          format: (v) =>
            typeof v === "number" && v > 0
              ? v.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 })
              : "—",
        },
        {
          key: "agreementExpiresAt",
          label: "Agreement Expires",
          format: (v) => (v instanceof Date ? format(v, "MMM d, yyyy") : "—"),
        },
        { key: "flag", label: "Flag" },
      ],
      rows,
      emptyMessage: "No active partnerships.",
    };
  },
};
