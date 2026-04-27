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

  let sent = 0;
  let failed = 0;
  const errors: string[] = [];
  for (const to of recipients) {
    try {
      const result = await sendFromTemplate(
        "report",
        {
          recipientName: to.split("@")[0],
          reportName,
          description: reportDescription,
          summary: output.summary,
          htmlBody,
          textBody,
          cta: { label: "Open admin", url: absoluteUrl("/admin/reports") },
        },
        {
          to,
          entityType: "scheduled-task",
          entityId: taskName,
        }
      );
      if (result.success) sent++;
      else {
        failed++;
        errors.push(`${to}: ${result.error ?? "send failed"}`);
      }
    } catch (err) {
      failed++;
      errors.push(`${to}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return {
    output: `${reportName} — ${output.summary} · sent to ${sent}/${recipients.length}`,
    warning: failed > 0 ? errors.join("\n") : undefined,
  };
};

// ─── EMAIL_MESSAGE ─────────────────────────────────────────────────────

const emailMessageHandler: Handler = async ({ config }) => {
  const subject = String(config.subject ?? "").trim();
  const body = String(config.body ?? "").trim();
  const recipients = parseRecipients(config.recipients);

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

  let sent = 0;
  let failed = 0;
  const errors: string[] = [];
  for (const to of recipients) {
    try {
      const result = await sendEmail(
        { to, subject, html, text },
        { entityType: "scheduled-task" }
      );
      if (result.success) sent++;
      else {
        failed++;
        errors.push(`${to}: ${result.error ?? "send failed"}`);
      }
    } catch (err) {
      failed++;
      errors.push(`${to}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return {
    output: `Sent "${subject}" to ${sent}/${recipients.length} recipient(s)`,
    warning: failed > 0 ? errors.join("\n") : undefined,
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

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
