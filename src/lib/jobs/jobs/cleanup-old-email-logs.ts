/**
 * cleanup-old-email-logs
 *
 * Two-stage retention for the EmailLog table:
 *
 *   1. Body scrub. After EMAIL_LOG_BODY_RETENTION_DAYS (default 30 days)
 *      we null out bodyHtml + bodyText on rows that are still kept,
 *      replacing them with a sentinel. The metadata (recipient, subject,
 *      messageId, status, error) stays intact for audit and forensics —
 *      that's what an admin actually needs after the immediate-debug
 *      window closes. This caps the privacy / GDPR exposure of long-
 *      retained email content.
 *
 *   2. Hard delete. After EMAIL_LOG_RETENTION_DAYS (default 365 days)
 *      the whole row is gone.
 *
 * Run weekly via cron. Idempotent. The (sentAt) index covers both
 * WHEREs.
 */

import { db } from "@/lib/db";
import { shouldRunWeekly } from "../gating";
import type { JobDefinition } from "../types";

const DEFAULT_BODY_SCRUB_DAYS = 30;
const DEFAULT_RETENTION_DAYS = 365;
const SCRUB_SENTINEL = "[scrubbed for retention]";

function readDays(envKey: string, fallback: number): number {
  const raw = process.env[envKey];
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export const cleanupOldEmailLogs: JobDefinition = {
  key: "cleanup-old-email-logs",
  name: "Cleanup old email logs",
  description:
    "Scrubs email bodies after 30 days and hard-deletes EmailLog rows after 365 days. Override with EMAIL_LOG_BODY_RETENTION_DAYS / EMAIL_LOG_RETENTION_DAYS.",
  schedule: "Weekly",

  async handler() {
    if (!(await shouldRunWeekly("cleanup-old-email-logs"))) {
      return { status: "skipped", output: "Already ran this week", processed: 0 };
    }

    const bodyDays = readDays("EMAIL_LOG_BODY_RETENTION_DAYS", DEFAULT_BODY_SCRUB_DAYS);
    const fullDays = readDays("EMAIL_LOG_RETENTION_DAYS", DEFAULT_RETENTION_DAYS);

    const now = Date.now();
    const bodyCutoff = new Date(now - bodyDays * 24 * 60 * 60 * 1000);
    const fullCutoff = new Date(now - fullDays * 24 * 60 * 60 * 1000);

    // Hard delete first so the body-scrub pass doesn't waste an UPDATE
    // on rows we're about to remove anyway.
    const deleted = await db.emailLog.deleteMany({
      where: { sentAt: { lt: fullCutoff } },
    });

    // Scrub bodies on rows older than `bodyDays` but newer than
    // `fullDays`. Skip rows already scrubbed (bodyHtml === sentinel)
    // so we don't repeatedly write the same sentinel.
    const scrubbed = await db.emailLog.updateMany({
      where: {
        sentAt: { lt: bodyCutoff },
        NOT: { bodyHtml: SCRUB_SENTINEL },
      },
      data: {
        bodyHtml: SCRUB_SENTINEL,
        bodyText: null,
      },
    });

    return {
      output: `Deleted ${deleted.count} log row${deleted.count === 1 ? "" : "s"} older than ${fullDays} days; scrubbed bodies on ${scrubbed.count} row${scrubbed.count === 1 ? "" : "s"} older than ${bodyDays} days`,
      processed: deleted.count + scrubbed.count,
    };
  },
};
