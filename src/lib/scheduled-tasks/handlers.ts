/**
 * Handlers for admin-built scheduled tasks.
 *
 * Each ScheduledTaskType has one handler. The runner looks up the
 * handler by type, calls it with the persisted config blob, and stores
 * the result on the task row so the admin UI can show last-run output
 * + errors.
 */

import { db } from "@/lib/db";
import { sendFromTemplate } from "@/lib/email";
import { sendEmail } from "@/lib/email";
import { log } from "@/lib/log";
import { absoluteUrl } from "@/lib/url";
import { getReport } from "@/lib/reports/registry";
import { getReportOverride } from "@/lib/reports/overrides";
import { runReport } from "@/lib/reports";
import { renderHtml, renderText } from "@/lib/reports/format";
import { runCustomReportFromRow } from "@/lib/reports/custom/runtime";
import type { ScheduledTaskType } from "@prisma/client";

export interface HandlerInput {
  taskId: string;
  taskName: string;
  config: Record<string, unknown>;
}

export interface HandlerResult {
  /** Short summary string shown in the admin "last run" column. */
  output: string;
  /** Soft error — handler completed but with degraded behavior (e.g.
   *  one of N email sends failed). When set, the runner persists it
   *  alongside a "success" status so the admin sees both. */
  warning?: string;
}

export type Handler = (input: HandlerInput) => Promise<HandlerResult>;

// ─── EMAIL_REPORT ──────────────────────────────────────────────────────

const emailReportHandler: Handler = async ({ taskName, config }) => {
  const reportKey = String(config.reportKey ?? "").trim();
  const recipients = parseRecipients(config.recipients);
  const cc = parseRecipients(config.cc);
  const bcc = parseRecipients(config.bcc);
  const replyTo = parseSingleAddress(config.replyTo);

  if (!reportKey) throw new Error("EMAIL_REPORT: missing reportKey");
  if (recipients.length === 0) {
    throw new Error("EMAIL_REPORT: recipients list is empty");
  }

  // The reportKey field carries either a system-report key (e.g.
  // "contracts-expiring") or a custom-report id with a `custom:`
  // prefix. We dispatch on prefix so the saved task config doesn't
  // need to track which kind it is.
  let reportName: string;
  let reportDescription: string;
  let output;
  if (reportKey.startsWith("custom:")) {
    const customId = reportKey.slice("custom:".length);
    const row = await db.customReport.findUnique({
      where: { id: customId },
    });
    if (!row) {
      throw new Error(`EMAIL_REPORT: custom report '${customId}' not found`);
    }
    // Deactivating a custom report must stop its scheduled emails too —
    // skip with a visible warning instead of sending stale data.
    if (!row.isActive) {
      return {
        output: `${row.name} — skipped: report deactivated`,
        warning: "skipped: report deactivated",
      };
    }
    reportName = row.name;
    reportDescription = row.description ?? "Custom report";
    output = await runCustomReportFromRow(row);
  } else {
    const report = getReport(reportKey);
    if (!report) {
      throw new Error(`EMAIL_REPORT: unknown report '${reportKey}'`);
    }
    // Hiding a report via its admin override must stop its scheduled
    // emails too (mirrors the custom-report isActive skip above). The
    // pre-check avoids running a potentially heavy query just to
    // discard the result.
    const override = await getReportOverride(reportKey);
    if (override?.hidden) {
      const name = override.displayName || report.name;
      return {
        output: `${name} — skipped: hidden by admin customization`,
        warning:
          "skipped: report hidden (un-hide it under Reports → open it → Customize)",
      };
    }
    const result = await runReport(reportKey, {
      triggeredAt: new Date(),
      triggeredBy: "scheduled-task",
    });
    reportName = result.name;
    reportDescription = result.description;
    output = result.output;
  }

  const htmlBody = renderHtml(output);
  const textBody = renderText(output);

  // Single send with the full To list (plus optional CC/BCC). This is
  // the standard mailing-list behavior and avoids duplicate copies for
  // CC/BCC recipients that a per-recipient loop would produce.
  const result = await sendFromTemplate(
    "report",
    {
      recipientName: "team",
      reportName,
      description: reportDescription,
      summary: output.summary,
      htmlBody,
      textBody,
      cta: { label: "Open admin", url: absoluteUrl("/admin/reports") },
    },
    {
      to: recipients,
      cc: cc.length > 0 ? cc : undefined,
      bcc: bcc.length > 0 ? bcc : undefined,
      replyTo,
      entityType: "scheduled-task",
      entityId: taskName,
    }
  );

  const totalRecipients = recipients.length + cc.length + bcc.length;
  if (!result.success) {
    return {
      output: `${reportName} — ${output.summary} · send failed`,
      warning: result.error ?? "send failed",
    };
  }
  return {
    output: `${reportName} — ${output.summary} · sent to ${totalRecipients} recipient${totalRecipients === 1 ? "" : "s"}`,
  };
};

// ─── EMAIL_MESSAGE ─────────────────────────────────────────────────────

const emailMessageHandler: Handler = async ({ config }) => {
  const subject = String(config.subject ?? "").trim();
  const body = String(config.body ?? "").trim();
  const recipients = parseRecipients(config.recipients);
  const cc = parseRecipients(config.cc);
  const bcc = parseRecipients(config.bcc);
  const replyTo = parseSingleAddress(config.replyTo);

  if (!subject) throw new Error("EMAIL_MESSAGE: missing subject");
  if (!body) throw new Error("EMAIL_MESSAGE: missing body");
  if (recipients.length === 0) {
    throw new Error("EMAIL_MESSAGE: recipients list is empty");
  }

  // The body field is freeform text from the admin form. We render
  // it as a <pre>-shaped paragraph so newlines come through but no
  // arbitrary HTML executes — admins type plain text, not markup.
  const html = `<div style="font-family:-apple-system,Segoe UI,Arial,sans-serif;font-size:14px;line-height:1.5;color:#1a1a1a;white-space:pre-wrap;">${escapeHtml(body)}</div>`;
  const text = body;

  // Single send with the full To list, plus CC/BCC. See note in the
  // EMAIL_REPORT handler for why we don't loop per recipient.
  const result = await sendEmail(
    {
      to: recipients,
      cc: cc.length > 0 ? cc : undefined,
      bcc: bcc.length > 0 ? bcc : undefined,
      replyTo,
      subject,
      html,
      text,
    },
    { entityType: "scheduled-task" }
  );

  const totalRecipients = recipients.length + cc.length + bcc.length;
  if (!result.success) {
    return {
      output: `Send failed for "${subject}"`,
      warning: result.error ?? "send failed",
    };
  }
  return {
    output: `Sent "${subject}" to ${totalRecipients} recipient${totalRecipients === 1 ? "" : "s"}`,
  };
};

// ─── PURGE_SOFT_DELETED ────────────────────────────────────────────────

const purgeSoftDeletedHandler: Handler = async ({ taskName, config }) => {
  // Lazy-import so the scheduled-task runtime in the cron worker
  // doesn't pay the soft-delete module's startup cost when it's not
  // running this task type.
  const { purgeOldSoftDeletes, DEFAULT_RETENTION_DAYS } = await import(
    "@/lib/soft-delete"
  );

  const retention = Number(config?.retentionDays);
  const retentionDays =
    Number.isFinite(retention) && retention > 0
      ? retention
      : DEFAULT_RETENTION_DAYS;

  const summary = await purgeOldSoftDeletes(retentionDays);
  const totalPurged = summary.reduce((acc, s) => acc + s.purged, 0);

  if (totalPurged === 0) {
    return {
      output: `${taskName}: nothing to purge (cutoff = ${retentionDays}d)`,
    };
  }
  // Surface a per-entity breakdown so an admin can spot-check the
  // numbers in the scheduled-task last-run column.
  const breakdown = summary
    .filter((s) => s.purged > 0)
    .map((s) => `${s.entity}=${s.purged}`)
    .join(" ");
  return {
    output: `Purged ${totalPurged} row${totalPurged === 1 ? "" : "s"} older than ${retentionDays}d (${breakdown})`,
  };
};

// ─── Registry ──────────────────────────────────────────────────────────

const HANDLERS: Record<ScheduledTaskType, Handler> = {
  EMAIL_REPORT: emailReportHandler,
  EMAIL_MESSAGE: emailMessageHandler,
  PURGE_SOFT_DELETED: purgeSoftDeletedHandler,
};

export async function runHandler(
  type: ScheduledTaskType,
  input: HandlerInput
): Promise<HandlerResult> {
  const handler = HANDLERS[type];
  if (!handler) throw new Error(`No handler registered for ${type}`);
  return handler(input);
}

// ─── Helpers ────────────────────────────────────────────────────────────

/**
 * Minimal sanity gate on top of the "contains @" check: control
 * characters (header-injection vectors), embedded spaces, more than
 * one "@", and over-long values (RFC 5321 caps the address at 254)
 * are all rejected rather than passed to the email driver.
 */
function isSaneEmailAddress(value: string): boolean {
  if (value.length > 254) return false;
  if (/[\r\n\0 ]/.test(value)) return false;
  if ((value.match(/@/g) ?? []).length !== 1) return false;
  return true;
}

function keepValidAddress(v: string): boolean {
  if (v.length === 0 || !v.includes("@")) return false;
  if (!isSaneEmailAddress(v)) {
    log.warn("scheduled-tasks.recipients", "Skipping invalid recipient address", {
      address: v.slice(0, 80),
    });
    return false;
  }
  return true;
}

function parseRecipients(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((v) => String(v).trim()).filter(keepValidAddress);
  }
  if (typeof value === "string") {
    return value
      .split(/[,;\s]+/)
      .map((v) => v.trim())
      .filter(keepValidAddress);
  }
  return [];
}

/**
 * For Reply-To, we accept the same shapes as parseRecipients but only
 * the first valid address — RFC 5322 allows multiple Reply-To addresses
 * but most providers and recipient clients treat one as the norm and
 * mishandle the rest. Returning undefined when nothing is provided
 * lets the caller skip the field entirely.
 */
function parseSingleAddress(value: unknown): string | undefined {
  const list = parseRecipients(value);
  return list.length > 0 ? list[0] : undefined;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
