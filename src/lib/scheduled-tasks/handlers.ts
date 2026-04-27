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
import { absoluteUrl } from "@/lib/url";
import { getReport } from "@/lib/reports/registry";
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
    reportName = row.name;
    reportDescription = row.description ?? "Custom report";
    output = await runCustomReportFromRow(row);
  } else {
    const report = getReport(reportKey);
    if (!report) {
      throw new Error(`EMAIL_REPORT: unknown report '${reportKey}'`);
    }
    reportName = report.name;
    reportDescription = report.description;
    output = await report.run({
      triggeredAt: new Date(),
      triggeredBy: "scheduled-task",
    });
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

// ─── Registry ──────────────────────────────────────────────────────────

const HANDLERS: Record<ScheduledTaskType, Handler> = {
  EMAIL_REPORT: emailReportHandler,
  EMAIL_MESSAGE: emailMessageHandler,
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

function parseRecipients(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((v) => String(v).trim())
      .filter((v) => v.length > 0 && v.includes("@"));
  }
  if (typeof value === "string") {
    return value
      .split(/[,;\s]+/)
      .map((v) => v.trim())
      .filter((v) => v.length > 0 && v.includes("@"));
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
