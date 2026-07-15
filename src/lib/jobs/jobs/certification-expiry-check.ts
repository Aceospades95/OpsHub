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
 *
 * EXPLAINABILITY — the run output is a per-certification ledger: which
 * certs were out of scope (no date / already expired / renewal already
 * submitted), which are waiting for their next threshold, which already
 * fired, and which sent to whom. "Checked 9, fired 0" stops being a
 * mystery; the output says exactly why each of the 9 stayed quiet.
 * Supports ctx.dryRun: evaluates and explains, sends/writes nothing.
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
  notificationTypes: ["certification-expiring"],
  supportsDryRun: true,

  async handler(ctx) {
    // Dry runs always evaluate — the point of a preview is to see what
    // the next real run would do, even right after one completed.
    if (!ctx.dryRun && !(await shouldRunDaily("certification-expiry-check"))) {
      return { status: "skipped", output: "Already ran today", processed: 0 };
    }
    const now = new Date();
    // Look out a generous window; we apply per-cert offsets in code.
    const generousHorizon = new Date();
    generousHorizon.setDate(generousHorizon.getDate() + 400);

    const inScopeWhere = {
      deletedAt: null,
      status: { not: "EXPIRED" as const },
      expirationDate: { gte: now, lte: generousHorizon },
      // Renewal already submitted → the org is waiting on the issuing
      // body; nagging about the expiry date helps nobody. Sign-off
      // clears the flag and re-arms reminders for the next cycle.
      renewalSubmittedAt: null,
    };

    const [certs, noDate, alreadyPast, renewalPending] = await Promise.all([
      db.certification.findMany({
        where: inScopeWhere,
        include: {
          assignee: { select: { id: true, name: true } },
          pointOfContact: { select: { id: true, name: true } },
        },
      }),
      // Out-of-scope populations, counted so the summary can say where
      // the rest of the certifications page's numbers went.
      db.certification.count({ where: { deletedAt: null, expirationDate: null } }),
      db.certification.count({
        where: {
          deletedAt: null,
          OR: [{ expirationDate: { lt: now } }, { status: "EXPIRED" }],
        },
      }),
      db.certification.count({
        where: {
          deletedAt: null,
          renewalSubmittedAt: { not: null },
          expirationDate: { gte: now },
          status: { not: "EXPIRED" },
        },
      }),
    ]);

    let notifiedCount = 0;
    const detail: string[] = [];

    for (const cert of certs) {
      if (!cert.expirationDate) continue;

      const recipients = [cert.assignee, cert.pointOfContact].filter(
        (u): u is { id: string; name: string } => u != null
      );

      const msUntilExpiry = cert.expirationDate.getTime() - now.getTime();
      const daysUntilExpiry = Math.ceil(msUntilExpiry / (1000 * 60 * 60 * 24));

      // Configured offsets, falling back to the legacy single lead if the
      // array is empty. Largest offset fires first as the cert approaches.
      const offsets = (cert.reminderOffsetsDays?.length
        ? cert.reminderOffsetsDays
        : [cert.renewalLeadDays ?? 90])
        .slice()
        .sort((a, b) => b - a);

      if (recipients.length === 0) {
        detail.push(
          `· ${cert.name}: expires in ${daysUntilExpiry}d — SKIPPED, no assignee or point of contact to notify`
        );
        continue;
      }

      // Find the tightest threshold that has been crossed but not yet fired.
      const firedArr = cert.firedReminderOffsets ?? [];
      const fired = new Set<number>(firedArr);
      const crossed = offsets.filter((o) => daysUntilExpiry <= o && !fired.has(o));
      if (crossed.length === 0) {
        const upcoming = offsets.filter((o) => daysUntilExpiry > o);
        if (upcoming.length > 0) {
          detail.push(
            `· ${cert.name}: expires in ${daysUntilExpiry}d — waiting; next reminder fires at ${Math.max(...upcoming)}d out (offsets: ${offsets.join("/")})`
          );
        } else {
          detail.push(
            `· ${cert.name}: expires in ${daysUntilExpiry}d — all reminders already sent this cycle (offsets: ${offsets.join("/")}; sign-off re-arms them)`
          );
        }
        continue;
      }

      // Fire the smallest crossed threshold (most urgent message) and mark
      // all larger-or-equal crossed offsets as fired so we don't double-send.
      const targetOffset = Math.min.apply(null, crossed);
      const newlyFiredSet = new Set<number>(firedArr);
      crossed.forEach((o) => newlyFiredSet.add(o));
      const newlyFired = Array.from(newlyFiredSet);

      const recipientNames = recipients.map((r) => r.name).join(", ");
      if (ctx.dryRun) {
        detail.push(
          `→ ${cert.name}: expires in ${daysUntilExpiry}d — WOULD send the ${targetOffset}-day reminder to ${recipientNames}`
        );
        notifiedCount += recipients.length;
        continue;
      }

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

      detail.push(
        `→ ${cert.name}: expires in ${daysUntilExpiry}d — sent the ${targetOffset}-day reminder to ${recipientNames}`
      );

      // Record which offsets have been fired so we don't repeat.
      await db.certification.update({
        where: { id: cert.id },
        data: { firedReminderOffsets: newlyFired },
      });
    }

    const summary = [
      `Checked ${certs.length} certification${certs.length === 1 ? "" : "s"} with an upcoming expiration date, ${ctx.dryRun ? "would fire" : "fired"} ${notifiedCount} reminder${notifiedCount === 1 ? "" : "s"}.`,
      `Not checked: ${noDate} with no expiration date, ${alreadyPast} already expired (reminders are pre-expiry; the cert page shows these as Expired), ${renewalPending} with a renewal already submitted (muted until sign-off).`,
      ...(detail.length > 0 ? ["", ...detail] : []),
    ].join("\n");

    return { output: summary, processed: notifiedCount };
  },
};
