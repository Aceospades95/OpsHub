/**
 * notification-email-digest
 *
 * One email a day per digest-mode user, listing the in-app
 * notifications they received since the last digest. Users opt in on
 * /notifications → Preferences ("Daily email digest"); while enabled,
 * notify() skips their immediate emails and this job delivers the
 * batch instead. In-app notifications are unaffected.
 *
 * Idempotent: each Notification row is stamped digestedAt when it
 * ships in a digest, so nothing repeats — a failed send leaves rows
 * unstamped for the next run. Enabling digest mode stamps the user's
 * backlog first (see setEmailDigestPref) so day one doesn't replay
 * history they already received in real time.
 *
 * Supports ctx.dryRun: evaluates and explains, sends/writes nothing.
 */

import { db } from "@/lib/db";
import { sendFromTemplate } from "@/lib/email";
import { absoluteUrl } from "@/lib/url";
import { shouldRunDaily } from "../gating";
import { getJobParams } from "../params";
import type { JobDefinition } from "../types";

const DEFAULTS = {
  /** Safety window — rows older than this are never digested. */
  lookbackDays: 7,
};

/** Cap per email so a runaway backlog can't build an unsendable body. */
const MAX_ITEMS_PER_DIGEST = 200;

export const notificationEmailDigest: JobDefinition = {
  key: "notification-email-digest",
  name: "Notification email digest",
  description:
    "Sends digest-mode users one daily email listing their new in-app notifications, instead of one email per event",
  schedule: "Daily",
  supportsDryRun: true,
  paramsSchema: [
    {
      key: "lookbackDays",
      label: "Lookback window (days)",
      type: "number",
      min: 1,
      defaultValue: DEFAULTS.lookbackDays,
      help: "Undigested notifications older than this are dropped from digests (they remain in the bell).",
    },
  ],

  async handler(ctx) {
    if (!ctx.dryRun && !(await shouldRunDaily("notification-email-digest"))) {
      return { status: "skipped", output: "Already ran today", processed: 0 };
    }
    const { lookbackDays } = await getJobParams("notification-email-digest", DEFAULTS);
    const since = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000);

    const users = await db.user.findMany({
      where: {
        notificationEmailDigest: true,
        isActive: true,
        hasLoginAccess: true,
      },
      select: { id: true, name: true, email: true },
      orderBy: { name: "asc" },
    });
    if (users.length === 0) {
      return {
        output:
          "No one has digest mode enabled (Notifications → Preferences → Daily email digest).",
        processed: 0,
      };
    }

    let sent = 0;
    let failedSends = 0;
    const detail: string[] = [];

    for (const user of users) {
      const items = await db.notification.findMany({
        where: {
          recipientId: user.id,
          digestedAt: null,
          createdAt: { gte: since },
        },
        orderBy: { createdAt: "asc" },
        take: MAX_ITEMS_PER_DIGEST,
        select: {
          id: true,
          title: true,
          body: true,
          href: true,
          createdAt: true,
        },
      });
      if (items.length === 0) {
        detail.push(`· ${user.name}: nothing new — no email`);
        continue;
      }
      if (ctx.dryRun) {
        detail.push(
          `→ ${user.name}: WOULD email a digest of ${items.length} notification${items.length === 1 ? "" : "s"}`
        );
        sent++;
        continue;
      }

      const htmlBody = `<ul style="margin:0;padding:0 0 0 18px;font-size:13px;line-height:1.6;color:#1a1a1a;">${items
        .map((n) => {
          const when = n.createdAt.toISOString().slice(0, 16).replace("T", " ");
          const title = n.href
            ? `<a href="${escapeAttr(absoluteUrl(n.href))}" style="color:#166534;">${escapeHtml(n.title)}</a>`
            : escapeHtml(n.title);
          const body = n.body
            ? ` — <span style="color:#555;">${escapeHtml(n.body)}</span>`
            : "";
          return `<li style="margin-bottom:6px;">${title}${body} <span style="color:#999;font-size:11px;">(${when} UTC)</span></li>`;
        })
        .join("")}</ul>`;
      const textBody = items
        .map((n) => {
          const when = n.createdAt.toISOString().slice(0, 16).replace("T", " ");
          return `- ${n.title}${n.body ? ` — ${n.body}` : ""} (${when} UTC)`;
        })
        .join("\n");

      const result = await sendFromTemplate(
        "report",
        {
          recipientName: user.name,
          reportName: "Daily notification digest",
          description:
            "Your in-app notifications from the last day, batched because digest mode is on.",
          summary: `${items.length} notification${items.length === 1 ? "" : "s"} since your last digest`,
          htmlBody,
          textBody,
          cta: { label: "Open notifications", url: absoluteUrl("/notifications") },
        },
        {
          to: user.email,
          entityType: "notification-digest",
          entityId: user.id,
        }
      );

      if (result.success) {
        await db.notification.updateMany({
          where: { id: { in: items.map((n) => n.id) } },
          data: { digestedAt: new Date() },
        });
        sent++;
        detail.push(
          `→ ${user.name}: emailed ${items.length} notification${items.length === 1 ? "" : "s"}`
        );
      } else {
        // Rows stay unstamped so tomorrow's digest retries them.
        failedSends++;
        detail.push(`· ${user.name}: send FAILED — items kept for the next digest`);
      }
    }

    const summary = [
      `${users.length} digest user${users.length === 1 ? "" : "s"}, ${ctx.dryRun ? "would send" : "sent"} ${sent} digest${sent === 1 ? "" : "s"}${failedSends > 0 ? ` (${failedSends} send failures — items retained)` : ""}.`,
      ...(detail.length > 0 ? ["", ...detail] : []),
    ].join("\n");

    return { output: summary, processed: sent };
  },
};

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttr(s: string): string {
  return escapeHtml(s);
}
