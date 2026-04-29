/**
 * certification-expiry-check
 *
 * Fires reminders when a certification crosses any of its configured
 * reminderOffsetsDays thresholds (e.g., 90, 30, 7 days before expiry).
 * Each offset is fired at most once per renewal cycle — the list of
 * already-fired offsets is stored on the certification and cleared
 * when the cert is signed off (new cycle).
 *
 * Notifies both the assignee and the point of contact.
 */

import { db } from "@/lib/db";
import { log } from "@/lib/log";
import { notify } from "@/lib/notifications";
import { absoluteUrl } from "@/lib/url";
import { shouldRunDaily } from "../gating";
import type { JobDefinition } from "../types";

export const certificationExpiryCheck: JobDefinition = {
  key: "certification-expiry-check",
  name: "Certification expiry check",
  description:
    "Fires multi-tier reminders (e.g. 90/30/7 days) when certifications approach their expiration date",
  schedule: "Daily",

  async handler() {
    if (!(await shouldRunDaily("certification-expiry-check"))) {
      return { status: "skipped", output: "Already ran today", processed: 0 };
    }
    const now = new Date();
    // Look out a generous window; we apply per-cert offsets in code.
    const generousHorizon = new Date();
    generousHorizon.setDate(generousHorizon.getDate() + 400);

    const certs = await db.certification.findMany({
      where: {
        status: { not: "EXPIRED" },
        expirationDate: { gte: now, lte: generousHorizon },
      },
      include: {
        assignee: { select: { id: true, name: true } },
        pointOfContact: { select: { id: true, name: true } },
      },
    });

    let notifiedCount = 0;

    for (const cert of certs) {
      if (!cert.expirationDate) continue;

      const recipients = [cert.assignee, cert.pointOfContact].filter(
        (u): u is { id: string; name: string } => u != null
      );
      if (recipients.length === 0) continue;

      const msUntilExpiry = cert.expirationDate.getTime() - now.getTime();
      const daysUntilExpiry = Math.ceil(msUntilExpiry / (1000 * 60 * 60 * 24));

      // Configured offsets, falling back to the legacy single lead if the
      // array is empty. Largest offset fires first as the cert approaches.
      const offsets = (cert.reminderOffsetsDays?.length
        ? cert.reminderOffsetsDays
        : [cert.renewalLeadDays ?? 90])
        .slice()
        .sort((a, b) => b - a);

      // Find the tightest threshold that has been crossed but not yet fired.
      const firedArr = cert.firedReminderOffsets ?? [];
      const fired = new Set<number>(firedArr);
      const crossed = offsets.filter((o) => daysUntilExpiry <= o && !fired.has(o));
      if (crossed.length === 0) continue;

      // Fire the smallest crossed threshold (most urgent message) and mark
      // all larger-or-equal crossed offsets as fired so we don't double-send.
      const targetOffset = Math.min.apply(null, crossed);
      const newlyFiredSet = new Set<number>(firedArr);
      crossed.forEach((o) => newlyFiredSet.add(o));
      const newlyFired = Array.from(newlyFiredSet);

      for (const recipient of recipients) {
        try {
          await notify({
            recipientId: recipient.id,
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
                recipientName: recipient.name,
                heading: `Certification renewal needed: ${cert.name}`,
                body: `${cert.name} expires in ${daysUntilExpiry} day${daysUntilExpiry === 1 ? "" : "s"} (${targetOffset}-day reminder). Review the renewal requirements and start the process if you haven't already.`,
                cta: {
                  label: "Open certification",
                  url: absoluteUrl(`/certifications/${cert.id}`),
                },
              },
            },
          });
          notifiedCount++;
        } catch (err) {
          log.error("jobs.certExpiry", "Notify failed", err, {
            recipientId: recipient.id,
            certId: cert.id,
          });
        }
      }

      // Record which offsets have been fired so we don't repeat.
      await db.certification.update({
        where: { id: cert.id },
        data: { firedReminderOffsets: newlyFired },
      });
    }

    return {
      output: `Checked ${certs.length} certification${certs.length === 1 ? "" : "s"}, fired ${notifiedCount} reminder${notifiedCount === 1 ? "" : "s"}`,
      processed: notifiedCount,
    };
  },
};
