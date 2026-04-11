/**
 * certification-expiry-check
 *
 * Finds certifications whose expirationDate falls within the renewal lead
 * window (defaults to 90 days from each cert's renewalLeadDays field) and
 * notifies the assigned responsible person.
 *
 * Each cert has its own lead window (default 90), so we filter per-row
 * rather than using one global cutoff.
 */

import { db } from "@/lib/db";
import { notify } from "@/lib/notifications";
import { absoluteUrl } from "@/lib/url";
import type { JobDefinition } from "../types";

export const certificationExpiryCheck: JobDefinition = {
  key: "certification-expiry-check",
  name: "Certification expiry check",
  description:
    "Notifies responsible parties when their certifications are within the renewal lead window",
  schedule: "Daily",

  async handler() {
    const now = new Date();
    // Pull a generous window so we can apply the per-cert lead in code
    const generousHorizon = new Date();
    generousHorizon.setDate(generousHorizon.getDate() + 365);

    const certs = await db.certification.findMany({
      where: {
        status: { not: "EXPIRED" },
        expirationDate: { gte: now, lte: generousHorizon },
        assigneeId: { not: null },
      },
      include: {
        assignee: { select: { id: true, name: true } },
      },
    });

    let notifiedCount = 0;

    for (const cert of certs) {
      if (!cert.expirationDate || !cert.assignee) continue;

      const leadDays = cert.renewalLeadDays ?? 90;
      const msUntilExpiry = cert.expirationDate.getTime() - now.getTime();
      const daysUntilExpiry = Math.ceil(msUntilExpiry / (1000 * 60 * 60 * 24));

      // Only notify when the cert has entered its lead window
      if (daysUntilExpiry > leadDays) continue;

      try {
        await notify({
          recipientId: cert.assignee.id,
          type: "certification-expiring",
          title: `Certification expiring in ${daysUntilExpiry} day${daysUntilExpiry === 1 ? "" : "s"}: ${cert.name}`,
          body: cert.issuingBody
            ? `${cert.issuingBody} · ${cert.name}`
            : cert.name,
          href: `/certifications/${cert.id}`,
          entityType: "certification",
          entityId: cert.id,
          email: {
            templateKey: "notification",
            data: {
              recipientName: cert.assignee.name,
              heading: `Certification renewal needed: ${cert.name}`,
              body: `${cert.name} expires in ${daysUntilExpiry} day${daysUntilExpiry === 1 ? "" : "s"}. Review the renewal requirements and start the process if you haven't already.`,
              cta: {
                label: "Open certification",
                url: absoluteUrl(`/certifications/${cert.id}`),
              },
            },
          },
        });
        notifiedCount++;
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error(
          `[certification-expiry-check] failed to notify for ${cert.id}:`,
          err
        );
      }
    }

    return {
      output: `Checked ${certs.length} certification${certs.length === 1 ? "" : "s"} in the next year, notified ${notifiedCount} within their renewal lead window`,
      processed: notifiedCount,
    };
  },
};
