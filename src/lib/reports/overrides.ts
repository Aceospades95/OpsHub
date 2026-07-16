/**
 * Built-in report overrides — the presentation layer an admin owns.
 *
 * The registry keeps each report's QUERY in code (bespoke logic the
 * custom builder can't express); a ReportOverride row re-skins
 * everything around it: display name, description, hidden state, a
 * display row cap, and per-column label / visibility / order. Applied
 * inside runReport(), so every consumer — admin runner, CSV download,
 * emailed reports, scheduled tasks, the daily digest — sees the same
 * customized shape.
 *
 * applyReportOverride is a PURE function so the whole permutation space
 * (labels × hidden × order × caps × unknown keys) is unit-testable
 * without a database.
 */

import { db } from "@/lib/db";
import { log } from "@/lib/log";
import type { ReportOutput } from "./types";

export interface ReportColumnOverride {
  label?: string;
  hidden?: boolean;
  order?: number;
}

export interface ReportOverrideData {
  displayName: string | null;
  description: string | null;
  hidden: boolean;
  maxRows: number | null;
  /** Keyed by ReportColumn.key. Unknown keys are ignored harmlessly. */
  columnConfig: Record<string, ReportColumnOverride> | null;
}

/**
 * Load the override for a report. Null (no row / lookup failure) =
 * stock behavior — the overrides layer can never take reports down.
 */
export async function getReportOverride(
  reportKey: string
): Promise<ReportOverrideData | null> {
  try {
    const row = await db.reportOverride.findUnique({ where: { reportKey } });
    if (!row) return null;
    return {
      displayName: row.displayName,
      description: row.description,
      hidden: row.hidden,
      maxRows: row.maxRows,
      columnConfig: parseColumnConfig(row.columnConfig),
    };
  } catch (err) {
    log.error("reports.overrides", "Override lookup failed", err, { reportKey });
    return null;
  }
}

/** Bulk form for list pages — one query for the whole registry. */
export async function getAllReportOverrides(): Promise<Map<string, ReportOverrideData>> {
  try {
    const rows = await db.reportOverride.findMany();
    return new Map(
      rows.map((row) => [
        row.reportKey,
        {
          displayName: row.displayName,
          description: row.description,
          hidden: row.hidden,
          maxRows: row.maxRows,
          columnConfig: parseColumnConfig(row.columnConfig),
        },
      ])
    );
  } catch (err) {
    log.error("reports.overrides", "Bulk override lookup failed", err);
    return new Map();
  }
}

/** Defensive parse — a hand-edited JSON blob degrades to "no config". */
export function parseColumnConfig(raw: unknown): Record<string, ReportColumnOverride> | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const out: Record<string, ReportColumnOverride> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const v = value as Record<string, unknown>;
    const entry: ReportColumnOverride = {};
    if (typeof v.label === "string" && v.label.trim()) entry.label = v.label.trim().slice(0, 120);
    if (typeof v.hidden === "boolean") entry.hidden = v.hidden;
    if (typeof v.order === "number" && Number.isFinite(v.order)) entry.order = v.order;
    if (Object.keys(entry).length > 0) out[key] = entry;
  }
  return Object.keys(out).length > 0 ? out : null;
}

/**
 * Apply an override to a report's output. Pure.
 *
 * - Column labels replaced where overridden.
 * - Hidden columns removed (from headers AND row objects, so CSVs
 *   can't leak a hidden column) — but if the config would hide EVERY
 *   column, the override is ignored for visibility (a report with zero
 *   columns is a broken screen, not a customization).
 * - Columns sorted by (order ?? original index); ties keep original
 *   relative order.
 * - Rows truncated to maxRows with a summary suffix noting the cap.
 */
export function applyReportOverride(
  output: ReportOutput,
  override: ReportOverrideData | null
): ReportOutput {
  if (!override) return output;

  const config = override.columnConfig ?? {};

  let columns = output.columns.map((col, index) => {
    const c = config[col.key];
    return {
      col: c?.label ? { ...col, label: c.label } : col,
      hidden: c?.hidden === true,
      sortKey: c?.order ?? index,
      index,
    };
  });

  const visible = columns.filter((c) => !c.hidden);
  if (visible.length > 0) {
    columns = visible;
  }
  columns.sort((a, b) => a.sortKey - b.sortKey || a.index - b.index);
  const finalColumns = columns.map((c) => c.col);

  const keep = new Set(finalColumns.map((c) => c.key));
  let rows = output.rows;
  // Strip hidden columns' values so CSV/email renderers can't leak them.
  if (finalColumns.length !== output.columns.length) {
    rows = rows.map((row) => {
      const out: Record<string, unknown> = {};
      for (const key of Object.keys(row)) {
        if (keep.has(key)) out[key] = row[key];
      }
      return out;
    });
  }

  let summary = output.summary;
  if (
    override.maxRows != null &&
    override.maxRows > 0 &&
    rows.length > override.maxRows
  ) {
    summary = `${summary} · showing first ${override.maxRows} of ${rows.length} rows (display cap)`;
    rows = rows.slice(0, override.maxRows);
  }

  return { ...output, summary, columns: finalColumns, rows };
}
