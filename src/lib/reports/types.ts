/**
 * Shared types for the reporting infrastructure.
 *
 * Same pattern as the email, jobs, storage, and importers layers: a
 * registry of definitions, one `runReport()` entry point, and an admin
 * UI that picks up every registered report automatically.
 *
 * Kept side-effect-free so templates and UI code can import without
 * pulling in the database client.
 */

/** A column in a report table. */
export interface ReportColumn {
  /** Property name on each row */
  key: string;
  /** Column header shown in the rendered table + CSV */
  label: string;
  /**
   * Optional formatter for HTML/CSV cells. Default is String(value) with
   * nulls rendered as an em-dash (`—`) for HTML / empty string for CSV.
   * Keep return values as plain strings — HTML escaping is handled by
   * the renderer so formatters don't have to think about it.
   */
  format?: (value: unknown) => string;
  /**
   * CSS text-alignment hint for the HTML renderer. Numeric columns often
   * look better right-aligned.
   */
  align?: "left" | "right" | "center";
}

/**
 * The structured output of running a report. Rows are plain objects keyed
 * by `ReportColumn.key`. Summary is free-form text shown at the top of
 * the HTML/email/admin view — use it for "X items, Y overdue" etc.
 */
export interface ReportOutput {
  /** Free-form headline summary (e.g., "12 contracts expiring in the next 30 days") */
  summary: string;
  columns: ReportColumn[];
  rows: Record<string, unknown>[];
  /**
   * Optional hint for the admin UI's "no data" message when rows is empty.
   * Defaults to "No rows match this report right now."
   */
  emptyMessage?: string;
}

/**
 * Context passed into every report handler. `triggeredBy` is either a
 * user id (manual run / download / email-send) or "cron" for scheduled
 * runs through the jobs system.
 */
export interface ReportContext {
  triggeredAt: Date;
  triggeredBy: string;
}

/**
 * A report definition. Add new entries to the REPORTS registry in
 * `src/lib/reports/registry.ts` to make them runnable.
 *
 * Handlers should be idempotent and read-only — reports never mutate data.
 */
export interface ReportDefinition {
  /** Unique key — used in URLs, admin UI, and the scheduled job runner */
  key: string;
  /** Display name */
  name: string;
  /** What this report answers — one or two sentences */
  description: string;
  /**
   * Which module this report belongs to (e.g., "contracts"). Used by the
   * admin UI to group reports and by permission gating.
   */
  module: string;
  /**
   * Whether this report is safe to email in a scheduled digest.
   * Tune down for noisy reports that should only be pulled on demand.
   */
  schedulable?: boolean;
  /** The report implementation. Should not throw — return ReportOutput. */
  run: (ctx: ReportContext) => Promise<ReportOutput>;
}
