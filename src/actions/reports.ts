"use server";

/**
 * Server actions for the reporting system.
 *
 * - runReportAction — execute a report and return the structured output
 *   for display in the admin UI
 * - emailReportAction — run a report and email it to one or more
 *   recipients using the "report" template
 *
 * CSV download is handled by the dedicated API route at
 * `/api/reports/[key]/csv` (binary body + content-disposition headers).
 *
 * Admin-only. Reports are read-only so these actions don't mutate data,
 * but they can be expensive so we gate them the same way as other admin
 * tools.
 */

import { requireAuth } from "@/lib/permissions";
import { runReport, renderHtml, renderText } from "@/lib/reports";
import { sendFromTemplate } from "@/lib/email";
import { absoluteUrl } from "@/lib/url";
import { db } from "@/lib/db";

function requireAdmin(role: string) {
  if (role !== "ADMIN") throw new Error("Admin access required");
}

/**
 * Execute a report and return the raw output. Used by the admin preview
 * page — the client renders its own HTML table from this so we don't
 * double-render on the server.
 */
export async function runReportAction(key: string) {
  const user = await requireAuth();
  requireAdmin(user.role);

  try {
    const { output, name, description } = await runReport(key, {
      triggeredAt: new Date(),
      triggeredBy: user.id,
    });
    // Strip non-serializable `format` callbacks from columns before
    // returning to the client — the client has its own formatCell.
    const safeOutput = {
      ...output,
      columns: output.columns.map(({ format: _f, ...rest }) => rest),
    };
    return { success: true as const, name, description, output: safeOutput };
  } catch (err) {
    return {
      success: false as const,
      error: err instanceof Error ? err.message : "Failed to run report",
    };
  }
}

/**
 * Run a report and email it to the supplied addresses (or to the current
 * admin user if no recipients are given). The email uses the `report`
 * template and embeds the full HTML table + plain-text fallback.
 *
 * We resolve user ids to email addresses when they look like cuids,
 * otherwise we treat them as raw email addresses — that way the
 * recipient picker in the UI can pass either.
 */
export async function emailReportAction(
  key: string,
  recipients: string[]
) {
  const user = await requireAuth();
  requireAdmin(user.role);

  if (recipients.length === 0) {
    return { success: false as const, error: "No recipients specified" };
  }

  try {
    const { output, name, description } = await runReport(key, {
      triggeredAt: new Date(),
      triggeredBy: user.id,
    });

    // Resolve recipients → email addresses. Anything that looks like a
    // valid email is used as-is; anything else is treated as a user id
    // and looked up.
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const directEmails = recipients.filter((r) => emailRegex.test(r));
    const userIds = recipients.filter((r) => !emailRegex.test(r));
    const users = userIds.length
      ? await db.user.findMany({
          where: { id: { in: userIds }, isActive: true },
          select: { id: true, name: true, email: true },
        })
      : [];

    const toList = [
      ...directEmails,
      ...users.map((u) => u.email),
    ].filter(Boolean);

    if (toList.length === 0) {
      return { success: false as const, error: "No valid recipients resolved" };
    }

    const htmlBody = renderHtml(output);
    const textBody = renderText(output);
    // Each recipient gets their own email so the "Hi {name}" line can be
    // personalized. Fall back to "team" when we can't resolve a name.
    const nameByEmail = new Map(users.map((u) => [u.email, u.name]));

    let sent = 0;
    let failed = 0;
    for (const to of toList) {
      const recipientName = nameByEmail.get(to) || "team";
      const result = await sendFromTemplate(
        "report",
        {
          recipientName,
          reportName: name,
          description,
          summary: output.summary,
          htmlBody,
          textBody,
          cta: {
            label: "Open in OpsHub",
            url: absoluteUrl(`/admin/reports/${key}`),
          },
        },
        { to, entityType: "report", entityId: key }
      );
      if (result.success) sent++;
      else failed++;
    }

    return {
      success: true as const,
      sent,
      failed,
      total: toList.length,
    };
  } catch (err) {
    return {
      success: false as const,
      error: err instanceof Error ? err.message : "Failed to email report",
    };
  }
}

