"use server";

/**
 * Server actions for the reporting system.
 *
 * - runReportAction — execute a report and return the structured output
 *   for display in the admin UI
 * - emailReportAction — run a report and email it to one or more
 *   recipients using the "report" template
 * - saveReportOverride / resetReportOverride — persist or clear an
 *   admin's customization of a built-in report (rename, relabel, hide,
 *   reorder, row cap). Applied inside runReport so every consumer sees
 *   the customized shape.
 *
 * CSV download is handled by the dedicated API route at
 * `/api/reports/[key]/csv` (binary body + content-disposition headers).
 *
 * Admin-only. Report runs are read-only but can be expensive; override
 * writes mutate config so they also log to the activity feed.
 */

import { revalidatePath } from "next/cache";

import { requireAuth } from "@/lib/permissions";
import { runReport, getReport, parseColumnConfig } from "@/lib/reports";
import { renderHtml, renderText } from "@/lib/reports";
import { runCustomReportFromRow } from "@/lib/reports/custom/runtime";
import { sendFromTemplate } from "@/lib/email";
import { absoluteUrl } from "@/lib/url";
import { logActivity } from "@/lib/activity";
import { db } from "@/lib/db";
import { log } from "@/lib/log";
import { Prisma } from "@prisma/client";

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
    const result = await resolveAndRun(key, user.id);
    const { output, name, description } = result;
    // Strip non-serializable `format` callbacks from columns before
    // returning to the client — the client has its own formatCell.
    const safeOutput = {
      ...output,
      columns: output.columns.map(({ format: _f, ...rest }) => rest),
    };
    return {
      success: true as const,
      name,
      description,
      output: safeOutput,
      // Customize-panel metadata: the stock (code-defined) shape plus
      // the current override, so the panel can render placeholders and
      // pre-fill the form without a second query.
      stockName: result.stockName,
      stockDescription: result.stockDescription,
      stockColumns: result.stockColumns,
      hidden: result.hidden,
      overridden: result.overridden,
      override: result.override,
    };
  } catch (err) {
    // Log the raw cause server-side; return a generic message so we
    // don't leak Prisma table names / SQL fragments to the client.
    log.error("reports.runReport", "Failed to run report", err, { key });
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
): Promise<Awaited<ReturnType<typeof runReport>>> {
  if (key.startsWith("custom:")) {
    const id = key.slice("custom:".length);
    const row = await db.customReport.findUnique({ where: { id } });
    if (!row) throw new Error(`Custom report ${id} not found`);
    const output = await runCustomReportFromRow(row);
    const name = row.name;
    const description = row.description ?? "Custom report";
    // Custom reports are edited through their own builder, not the
    // override layer — stock === current and there's never an override.
    return {
      output,
      name,
      description,
      stockName: name,
      stockDescription: description,
      stockColumns: output.columns.map((c) => ({ key: c.key, label: c.label })),
      hidden: false,
      overridden: false,
      override: null,
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
      log.error("reports.emailReport", "Driver error", result.error, { key });
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
    log.error("reports.emailReport", "Failed to email report", err, { key });
    return {
      success: false as const,
      error: "Failed to email report. Check server logs for details.",
    };
  }
}

// ─── Report overrides (customize built-in reports) ─────────────────────

export interface SaveReportOverrideInput {
  /** Empty string clears the rename (falls back to the stock name). */
  displayName: string;
  /** Empty string clears the custom description. */
  description: string;
  /** Hide from pickers, the daily digest, and scheduled sends. */
  hidden: boolean;
  /** Display row cap; null = no cap. */
  maxRows: number | null;
  /** Per-column {label, hidden, order} keyed by column key; null = stock. */
  columnConfig: Record<
    string,
    { label?: string; hidden?: boolean; order?: number }
  > | null;
}

const MAX_DISPLAY_NAME = 120;
const MAX_DESCRIPTION = 1000;
const MAX_ROWS_CAP = 50_000;
const MAX_COLUMN_ENTRIES = 200;

/**
 * Persist an admin's customization of a built-in report. If every field
 * is stock (no rename, no description, visible, no cap, no column
 * config) the row is deleted instead — absence of a row IS the reset
 * state, so "save with everything blank" and "reset" converge.
 */
export async function saveReportOverride(
  key: string,
  input: SaveReportOverrideInput
) {
  const user = await requireAuth();
  const gate = requireAdmin(user.role);
  if (gate) return { success: false as const, error: gate.error };

  const report = getReport(key);
  if (!report) {
    return { success: false as const, error: "Unknown report" };
  }

  const displayName = String(input.displayName ?? "").trim();
  if (displayName.length > MAX_DISPLAY_NAME) {
    return {
      success: false as const,
      error: `Display name is too long (max ${MAX_DISPLAY_NAME} characters)`,
    };
  }
  const description = String(input.description ?? "").trim();
  if (description.length > MAX_DESCRIPTION) {
    return {
      success: false as const,
      error: `Description is too long (max ${MAX_DESCRIPTION} characters)`,
    };
  }

  let maxRows: number | null = null;
  if (input.maxRows !== null && input.maxRows !== undefined) {
    if (
      typeof input.maxRows !== "number" ||
      !Number.isInteger(input.maxRows) ||
      input.maxRows < 1 ||
      input.maxRows > MAX_ROWS_CAP
    ) {
      return {
        success: false as const,
        error: `Row cap must be a whole number between 1 and ${MAX_ROWS_CAP.toLocaleString()}`,
      };
    }
    maxRows = input.maxRows;
  }

  if (
    input.columnConfig &&
    Object.keys(input.columnConfig).length > MAX_COLUMN_ENTRIES
  ) {
    return { success: false as const, error: "Too many column entries" };
  }
  // Same defensive parse the read path uses — anything malformed
  // degrades to "no config" instead of persisting junk.
  const columnConfig = parseColumnConfig(input.columnConfig ?? null);

  const hidden = input.hidden === true;
  const isStock =
    !displayName && !description && !hidden && maxRows === null && !columnConfig;

  try {
    if (isStock) {
      await db.reportOverride.deleteMany({ where: { reportKey: key } });
      await logActivity("updated", "report-override", key, user.id, `${report.name} (reset to stock)`);
    } else {
      const data = {
        displayName: displayName || null,
        description: description || null,
        hidden,
        maxRows,
        // Interface types don't satisfy Prisma's InputJsonValue index
        // signature — the shape is already sanitized by parseColumnConfig.
        columnConfig: columnConfig
          ? (columnConfig as Prisma.InputJsonValue)
          : Prisma.DbNull,
      };
      await db.reportOverride.upsert({
        where: { reportKey: key },
        create: { reportKey: key, ...data },
        update: data,
      });
      await logActivity("updated", "report-override", key, user.id, displayName || report.name);
    }
    revalidatePath("/admin/reports");
    revalidatePath(`/admin/reports/${key}`);
    revalidatePath("/admin/scheduled-tasks");
    return { success: true as const, cleared: isStock };
  } catch (err) {
    log.error("reports.saveOverride", "Failed to save report override", err, { key });
    return {
      success: false as const,
      error: "Failed to save customization. Check server logs for details.",
    };
  }
}

/** Delete the override row — the report reverts to its code-defined self. */
export async function resetReportOverride(key: string) {
  const user = await requireAuth();
  const gate = requireAdmin(user.role);
  if (gate) return { success: false as const, error: gate.error };

  const report = getReport(key);
  if (!report) {
    return { success: false as const, error: "Unknown report" };
  }

  try {
    await db.reportOverride.deleteMany({ where: { reportKey: key } });
    await logActivity("updated", "report-override", key, user.id, `${report.name} (reset to stock)`);
    revalidatePath("/admin/reports");
    revalidatePath(`/admin/reports/${key}`);
    revalidatePath("/admin/scheduled-tasks");
    return { success: true as const };
  } catch (err) {
    log.error("reports.resetOverride", "Failed to reset report override", err, { key });
    return {
      success: false as const,
      error: "Failed to reset customization. Check server logs for details.",
    };
  }
}

