/**
 * contract-expiry-check
 *
 * Finds contracts whose endDate (or renewalDate) falls within the next 30
 * days and notifies the client's account manager so they can start renewal
 * negotiations. Idempotent — re-running within a few hours won't double-
 * notify because the previous run already created the in-app rows.
 *
 * Future: track per-contract "last warning sent" so we can re-notify on a
 * cadence (30/14/7/1 days) without spamming. For now, this fires once per
 * contract per run window.
 */

import { db } from "@/lib/db";
import { log } from "@/lib/log";
import { notify } from "@/lib/notifications";
import { absoluteUrl } from "@/lib/url";
import { shouldRunDaily } from "../gating";
import type { JobDefinition } from "../types";

export const contractExpiryCheck: JobDefinition = {
  key: "contract-expiry-check",
  name: "Contract expiry check",
  description:
    "Notifies account managers when their clients' contracts are within 30 days of expiring or renewal",
  schedule: "Daily",

  async handler() {
    if (!(await shouldRunDaily("contract-expiry-check"))) {
      return { status: "skipped", output: "Already ran today", processed: 0 };
    }
    const now = new Date();
    const horizon = new Date();
    horizon.setDate(horizon.getDate() + 30);

    // Find ACTIVE contracts whose end or renewal date is in the window
    const contracts = await db.contract.findMany({
      where: {
        deletedAt: null,
        status: { in: ["ACTIVE", "EXPIRING_SOON"] },
        OR: [
          { endDate: { gte: now, lte: horizon } },
          { renewalDate: { gte: now, lte: horizon } },
        ],
      },
      include: {
        client: { select: { id: true, name: true, accountManagerId: true } },
      },
    });

    let notifiedCount = 0;

    for (const contract of contracts) {
      const recipientId = contract.client?.accountManagerId;
      if (!recipientId) continue;

      // Pick the soonest of end / renewal date for the message
      const dates = [contract.endDate, contract.renewalDate].filter(
        (d): d is Date => d !== null
      );
      if (dates.length === 0) continue;
      const soonest = dates.reduce((a, b) => (a < b ? a : b));
      const daysUntil = Math.ceil(
        (soonest.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
      );

      try {
        await notify({
          recipientId,
          type: "system",
          title: `Contract expiring in ${daysUntil} day${daysUntil === 1 ? "" : "s"}: ${contract.title}`,
          body: contract.client
            ? `${contract.client.name} · ${contract.title}`
            : contract.title,
          href: `/contracts/${contract.id}`,
          entityType: "contract",
          entityId: contract.id,
          email: {
            templateKey: "notification",
            data: {
              recipientName: "team",
              heading: `Contract expiring soon: ${contract.title}`,
              body: `${contract.client?.name || "A contract"} expires in ${daysUntil} day${daysUntil === 1 ? "" : "s"}. Review the renewal details and take action if needed.`,
              cta: {
                label: "Open contract",
                url: absoluteUrl(`/contracts/${contract.id}`),
              },
            },
          },
        });
        notifiedCount++;
      } catch (err) {
        log.error("jobs.contractExpiry", "Notify failed", err, {
          contractId: contract.id,
        });
      }
    }

    return {
      output: `Found ${contracts.length} contract${contracts.length === 1 ? "" : "s"} expiring in the next 30 days, notified ${notifiedCount}`,
      processed: notifiedCount,
    };
  },
};
