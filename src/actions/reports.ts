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
import { runCustomReportFromRow } from "@/lib/reports/custom/runtime";
import { sendFromTemplate } from "@/lib/email";
import { absoluteUrl } from "@/lib/url";
import { db } from "@/lib/db";

function requireAdmin(role: string): { error: string } | null {
  if (role !== "ADMIN") {
    return { error: "Admin access required" };
  }
  return null;
}

/**
 * Execute a report and return the raw output. Used by the admin preview
 * page — the client renders its own HTML table from this so we don't
 * double-render on the server.
 */
export async function runReportAction(key: string) {
  const user = await requireAuth();
  const gate = requireAdmin(user.role);
  if (gate) return { success: false as const, error: gate.error };

  try {
    const { output, name, description } = await resolveAndRun(key, user.id);
    // Strip non-serializable `format` callbacks from columns before
    // returning to the client — the client has its own formatCell.
    const safeOutput = {
      ...output,
      columns: output.columns.map(({ format: _f, ...rest }) => rest),
    };
    return { success: true as const, name, description, output: safeOutput };
  } catch (err) {
    // Log the raw cause server-side; return a generic message so we
    // don't leak Prisma table names / SQL fragments to the client.
    // eslint-disable-next-line no-console
    console.error(`[reports] runReportAction(${key}) failed:`, err);
    return {
      success: false as const,
      error: "Failed to run report. Check server logs for details.",
    };
  }
}

/**
 * Resolve a report key — either a system-report key or a `custom:{id}`
 * reference to a CustomReport row — and execute it. Returns a uniform
 * shape so callers don't have to know which kind they got.
 */
async function resolveAndRun(
  key: string,
  triggeredBy: string
): Promise<{
  output: Awaited<ReturnType<typeof runReport>>["output"];
  name: string;
  description: string;
}> {
  if (key.startsWith("custom:")) {
    const id = key.slice("custom:".length);
    const row = await db.customReport.findUnique({ where: { id } });
    if (!row) throw new Error(`Custom report ${id} not found`);
    const output = await runCustomReportFromRow(row);
    return {
      output,
      name: row.name,
      description: row.description ?? "Custom report",
    };
  }
  return runReport(key, {
    triggeredAt: new Date(),
    triggeredBy,
  });
}

/**
 * Run a report and email it to the supplied addresses (or to the current
 * admin user if no recipients are given). The email uses the `report`
 * template and embeds the full HTML table + plain-text fallback.
 *
 * We resolve user ids to email addresses when they look like cuids,
 * otherwise we treat them as raw email addresses — that way the
 * recipient picker in the UI can pass either.
 *
 * `cc` / `bcc` accept the same shape (user ids or raw addresses) and are
 * resolved the same way. `replyTo` is a single email — useful when the
 * From address is a no-reply mailbox and you want responses to land in a
 * shared inbox instead of bouncing.
 */
export async function emailReportAction(
  key: string,
  recipients: string[],
  options: {
    cc?: string[];
    bcc?: string[];
    replyTo?: string;
  } = {}
) {
  const user = await requireAuth();
  const gate = requireAdmin(user.role);
  if (gate) return { success: false as const, error: gate.error };

  if (recipients.length === 0) {
    return { success: false as const, error: "No recipients specified" };
  }

  try {
    const { output, name, description } = await resolveAndRun(key, user.id);

    // Resolve recipients → email addresses. Anything that looks like a
    // valid email is used as-is; anything else is treated as a user id
    // and looked up.
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const allInputs = [
      ...recipients,
      ...(options.cc ?? []),
      ...(options.bcc ?? []),
    ];
    const userIds = allInputs.filter((r) => !emailRegex.test(r));
    const users = userIds.length
      ? await db.user.findMany({
          where: { id: { in: userIds }, isActive: true },
          select: { id: true, email: true },
        })
      : [];
    const userIdToEmail = new Map(users.map((u) => [u.id, u.email]));

    const resolveList = (raw: string[]) =>
      raw
        .map((r) => (emailRegex.test(r) ? r : userIdToEmail.get(r)))
        .filter((v): v is string => Boolean(v));

    const toList = resolveList(recipients);
    const ccList = resolveList(options.cc ?? []);
    const bccList = resolveList(options.bcc ?? []);

    if (toList.length === 0) {
      return { success: false as const, error: "No valid recipients resolved" };
    }

    const htmlBody = renderHtml(output);
    const textBody = renderText(output);

    // One send per click — all addresses share the same envelope so
    // CC/BCC people see the To list as the conversation context. The
    // greeting falls back to "team" since a single mailing-list email
    // can't be personalized to N different recipients.
    const ctaUrl = key.startsWith("custom:")
      ? absoluteUrl(`/admin/reports/custom/${key.slice("custom:".length)}`)
      : absoluteUrl(`/admin/reports/${key}`);

    const result = await sendFromTemplate(
      "report",
      {
        recipientName: "team",
        reportName: name,
        description,
        summary: output.summary,
        htmlBody,
        textBody,
        cta: {
          label: "Open in OpsHub",
          url: ctaUrl,
        },
      },
      {
        to: toList,
        cc: ccList.length > 0 ? ccList : undefined,
        bcc: bccList.length > 0 ? bccList : undefined,
        replyTo: options.replyTo?.trim() || undefined,
        entityType: "report",
        entityId: key,
      }
    );

    const total = toList.length + ccList.length + bccList.length;
    if (!result.success) {
      // Driver error messages can include SMTP server details and
      // host paths — log them but don't surface them to the admin UI.
      // eslint-disable-next-line no-console
      console.error(`[reports] emailReportAction(${key}) driver error:`, result.error);
    }
    return {
      success: true as const,
      sent: result.success ? total : 0,
      failed: result.success ? 0 : total,
      total,
      error: result.success
        ? undefined
        : "Email driver returned an error — see server logs.",
    };
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`[reports] emailReportAction(${key}) failed:`, err);
    return {
      success: false as const,
      error: "Failed to email report. Check server logs for details.",
    };
  }
}

