/**
 * daily-reports-digest
 *
 * Runs every schedulable report and emails the combined output as a
 * single digest to all ADMIN users. Designed to give admins a daily
 * "state of the world" without having to click into the reports page.
 *
 * One email per admin with every report inlined. Errors from individual
 * reports are swallowed into the digest body rather than failing the
 * whole job — a broken query on one report shouldn't silence the rest.
 */

import { db } from "@/lib/db";
import { sendFromTemplate } from "@/lib/email";
import { absoluteUrl } from "@/lib/url";
import {
  listSchedulableReports,
  runReport,
  renderHtml,
  renderText,
} from "@/lib/reports";
import { shouldRunDaily } from "../gating";
import type { JobDefinition } from "../types";

export const dailyReportsDigest: JobDefinition = {
  key: "daily-reports-digest",
  name: "Daily reports digest",
  description:
    "Runs every schedulable report and emails a combined digest to admin users.",
  schedule: "Daily",

  async handler(ctx) {
    if (!(await shouldRunDaily("daily-reports-digest"))) {
      return { status: "skipped", output: "Already ran today", processed: 0 };
    }
    const reports = listSchedulableReports();
    if (reports.length === 0) {
      return { output: "No schedulable reports configured.", processed: 0 };
    }

    // Run each report. Capture failures as a fake ReportOutput so they
    // show up in the digest as "(failed to run)" rather than killing
    // the whole job.
    const results = await Promise.all(
      reports.map(async (r) => {
        try {
          const { output, name, description } = await runReport(r.key, {
            triggeredAt: ctx.triggeredAt,
            triggeredBy: ctx.triggeredBy,
          });
          return { key: r.key, name, description, output, error: null as string | null };
        } catch (err) {
          return {
            key: r.key,
            name: r.name,
            description: r.description,
            output: null,
            error: err instanceof Error ? err.message : "Unknown error",
          };
        }
      })
    );

    // Build a single concatenated HTML + text body that renders every
    // report as its own section
    const htmlSections = results.map((r) => {
      const header = `<h2 style="margin:24px 0 8px;font-size:16px;font-weight:600;color:#111;">${escapeHtml(r.name)}</h2>
<p style="margin:0 0 12px;font-size:12px;color:#666;">${escapeHtml(r.description)}</p>`;
      if (r.error) {
        return `${header}<p style="color:#c00;font-size:13px;">Failed to run: ${escapeHtml(r.error)}</p>`;
      }
      return `${header}${renderHtml(r.output!)}`;
    });
    const htmlBody = htmlSections.join("\n");

    const textSections = results.map((r) => {
      if (r.error) return `== ${r.name} ==\nFailed to run: ${r.error}\n`;
      return `== ${r.name} ==\n${renderText(r.output!)}\n`;
    });
    const textBody = textSections.join("\n");

    // Find admins. We only digest to login-capable admins — anyone
    // without an email can't receive it.
    const admins = await db.user.findMany({
      where: { role: "ADMIN", isActive: true, hasLoginAccess: true },
      select: { id: true, name: true, email: true },
    });
    if (admins.length === 0) {
      return { output: "No admin recipients configured.", processed: 0 };
    }

    let sent = 0;
    let failed = 0;
    for (const admin of admins) {
      const result = await sendFromTemplate(
        "report",
        {
          recipientName: admin.name,
          reportName: "Daily reports digest",
          description: `Combined results for ${results.length} report${results.length === 1 ? "" : "s"}.`,
          summary: `${results.length} report${results.length === 1 ? "" : "s"} run at ${ctx.triggeredAt.toISOString().slice(0, 16).replace("T", " ")} UTC`,
          htmlBody,
          textBody,
          cta: { label: "Open reports", url: absoluteUrl("/admin/reports") },
        },
        { to: admin.email, entityType: "report", entityId: "daily-digest" }
      );
      if (result.success) sent++;
      else failed++;
    }

    const totalFailed = results.filter((r) => r.error).length;
    return {
      output: `Ran ${results.length} report${results.length === 1 ? "" : "s"}${totalFailed > 0 ? ` (${totalFailed} failed)` : ""}, emailed ${sent} of ${admins.length} admin${admins.length === 1 ? "" : "s"}${failed > 0 ? ` (${failed} send failures)` : ""}`,
      processed: sent,
    };
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
