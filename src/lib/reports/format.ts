/**
 * Rendering helpers for reports.
 *
 * One report produces a ReportOutput (columns + rows + summary). This
 * module knows how to turn that into:
 *   - A CSV string for download
 *   - An HTML block for the admin preview and email body
 *   - A plain-text fallback for email clients that don't render HTML
 *
 * Kept framework-agnostic — no React, no DB — so it can run in
 * scheduled jobs and server actions equally.
 */

import type { ReportColumn, ReportOutput } from "./types";

// ─── Cell formatting ───────────────────────────────────────────

/**
 * Default formatter: null/undefined → "" (CSV) or "—" (HTML). Dates are
 * ISO-formatted, numbers passed through String(), booleans become yes/no.
 */
export function defaultFormatCell(value: unknown, mode: "html" | "csv"): string {
  if (value === null || value === undefined) return mode === "html" ? "—" : "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") return String(value);
  return String(value);
}

/**
 * Apply a column's formatter if present, otherwise fall back to the
 * default. Returns the plain, unescaped string — the HTML/CSV layers
 * handle escaping.
 */
export function formatCell(
  column: ReportColumn,
  value: unknown,
  mode: "html" | "csv"
): string {
  if (column.format) return column.format(value);
  return defaultFormatCell(value, mode);
}

// ─── CSV ────────────────────────────────────────────────────────

/**
 * Escape a single CSV value. Wraps values containing commas, quotes,
 * or newlines in double-quotes and doubles internal quotes.
 */
function csvEscape(value: string): string {
  if (value === "") return "";
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/**
 * Render a ReportOutput as a CSV string. Includes the header row and
 * one line per data row with CRLF line endings (Excel compatibility).
 */
export function renderCsv(report: ReportOutput): string {
  const header = report.columns.map((c) => csvEscape(c.label)).join(",");
  const lines = report.rows.map((row) =>
    report.columns.map((col) => csvEscape(formatCell(col, row[col.key], "csv"))).join(",")
  );
  return [header, ...lines].join("\r\n") + "\r\n";
}

// ─── HTML ───────────────────────────────────────────────────────

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Render the report as an HTML fragment containing a <table> (plus a
 * leading summary line). Inline styles only — email clients strip
 * <style> tags, so everything that needs to look a certain way has to
 * live on the element itself.
 */
export function renderHtml(report: ReportOutput): string {
  const headerCells = report.columns
    .map(
      (c) =>
        `<th style="text-align:${c.align || "left"};padding:8px 12px;background:#f3f3f3;border-bottom:1px solid #ddd;font-size:12px;font-weight:600;color:#333;">${escapeHtml(c.label)}</th>`
    )
    .join("");

  const bodyRows =
    report.rows.length === 0
      ? `<tr><td colspan="${report.columns.length}" style="padding:16px;text-align:center;color:#888;font-size:13px;">${escapeHtml(report.emptyMessage || "No rows match this report right now.")}</td></tr>`
      : report.rows
          .map((row) => {
            const cells = report.columns
              .map(
                (col) =>
                  `<td style="text-align:${col.align || "left"};padding:8px 12px;border-bottom:1px solid #eee;font-size:13px;color:#333;vertical-align:top;">${escapeHtml(formatCell(col, row[col.key], "html"))}</td>`
              )
              .join("");
            return `<tr>${cells}</tr>`;
          })
          .join("");

  return `<p style="margin:0 0 16px;font-size:14px;color:#333;">${escapeHtml(report.summary)}</p>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;width:100%;border:1px solid #ddd;border-radius:6px;overflow:hidden;">
  <thead><tr>${headerCells}</tr></thead>
  <tbody>${bodyRows}</tbody>
</table>`;
}

// ─── Plain text ─────────────────────────────────────────────────

/**
 * Plain-text rendering — summary line followed by a simple bullet list
 * of rows. We deliberately don't try to draw an ASCII table here; plain
 * text emails are usually just a fallback and a bullet list is more
 * legible in narrow email clients.
 */
export function renderText(report: ReportOutput): string {
  const lines: string[] = [report.summary, ""];
  if (report.rows.length === 0) {
    lines.push(report.emptyMessage || "No rows.");
  } else {
    for (const row of report.rows) {
      const parts = report.columns.map((col) => {
        const value = formatCell(col, row[col.key], "csv");
        return value ? `${col.label}: ${value}` : null;
      });
      lines.push(`- ${parts.filter(Boolean).join(" · ")}`);
    }
  }
  return lines.join("\n");
}
