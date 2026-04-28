/**
 * workflow-reminder-digest
 *
 * Daily digest email sent to ADMIN users summarizing what needs human
 * attention today: stuck workflow steps + quotes that have expired or
 * are about to. The same data the analytics dashboard surfaces, but
 * pushed to inboxes so admins don't have to remember to check.
 *
 * Run daily — recommended morning UTC. Idempotent: re-running the same
 * day re-emails the same content, which is fine (admins can deal).
 */

import { db } from "@/lib/db";
import { sendFromTemplate } from "@/lib/email";
import { absoluteUrl } from "@/lib/url";
import { findStuckSteps } from "@/lib/workflows/analytics";
import { shouldRunDaily } from "../gating";
import type { JobDefinition } from "../types";

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

export const workflowReminderDigest: JobDefinition = {
  key: "workflow-reminder-digest",
  name: "Workflow + quote reminder digest",
  description:
    "Daily email to admins listing stuck workflow steps and expiring/expired quotes.",
  schedule: "Daily",

  async handler() {
    if (!(await shouldRunDaily("workflow-reminder-digest"))) {
      return { status: "skipped", output: "Already ran today", processed: 0 };
    }
    const stuck = await findStuckSteps();

    // "Expiring or expired" — quotes with validUntil within ±7 days,
    // still in an open state. Already-expired quotes that have been
    // ACCEPTED or REJECTED don't need attention.
    const now = new Date();
    const sevenDaysAhead = new Date(now.getTime() + 7 * ONE_DAY_MS);
    const expiringQuotes = await db.quote.findMany({
      where: {
        status: { in: ["DRAFT", "SENT", "VIEWED", "EXPIRED"] },
        validUntil: { lte: sevenDaysAhead },
      },
      include: { client: { select: { name: true } } },
      orderBy: { validUntil: "asc" },
      take: 50,
    });

    const stuckEntries = stuck.map((s) => ({
      templateName: s.templateName,
      subjectName: s.subjectName,
      stepName: s.stepName,
      daysWaiting: s.daysWaiting,
      instanceUrl: absoluteUrl(`/workflows/instances/${s.instanceId}`),
    }));

    const quoteEntries = expiringQuotes.map((q) => ({
      quoteNumber: q.quoteNumber,
      title: q.title,
      clientName: q.client.name,
      daysUntilExpiry: q.validUntil
        ? Math.floor((q.validUntil.getTime() - now.getTime()) / ONE_DAY_MS)
        : 0,
      quoteUrl: absoluteUrl(`/quotes/${q.id}`),
    }));

    if (stuckEntries.length === 0 && quoteEntries.length === 0) {
      return {
        output: "Nothing to digest — no stuck workflows or expiring quotes.",
        processed: 0,
      };
    }

    // Recipients: every active ADMIN with login access. Each one gets
    // their own email so the audit log shows which admins were notified.
    const admins = await db.user.findMany({
      where: { role: "ADMIN", isActive: true, hasLoginAccess: true },
      select: { id: true, name: true, email: true },
    });
    if (admins.length === 0) {
      return {
        output: "No active admins to notify.",
        processed: 0,
      };
    }

    let sent = 0;
    for (const admin of admins) {
      try {
        await sendFromTemplate(
          "workflow-digest",
          {
            recipientName: admin.name.split(" ")[0] || admin.name,
            stuckItems: stuckEntries,
            expiringQuotes: quoteEntries,
            workflowAnalyticsUrl: absoluteUrl("/workflows/analytics"),
          },
          {
            to: admin.email,
            entityType: "system",
            entityId: "workflow-digest",
          }
        );
        sent++;
      } catch (err) {
        // Per-recipient failure shouldn't block the rest. Errors land
        // in EmailLog via the email layer — check there if needed.
        // eslint-disable-next-line no-console
        console.error(
          `[workflow-digest] failed for ${admin.email}:`,
          err instanceof Error ? err.message : err
        );
      }
    }

    return {
      output: `Sent to ${sent}/${admins.length} admin(s) · ${stuckEntries.length} stuck steps · ${quoteEntries.length} expiring quotes`,
      processed: sent,
    };
  },
};
