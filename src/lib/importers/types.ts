/**
 * Shared types for the CSV importer infrastructure.
 *
 * Same shape as the email/storage/jobs/notifications layers: definitions
 * live in a registry, a single commit() entry point handles writes +
 * audit logging, and an admin wizard surfaces the per-importer flow.
 */

/**
 * A field that the importer expects in the CSV. Used for both validation
 * (required fields must be present) and the column-mapping UI (label +
 * aliases let us auto-detect columns from common header variations).
 */
export interface ImportField {
  /** Internal field name passed to the commit handler */
  key: string;
  /** Display label in the mapping UI */
  label: string;
  /** Whether this field must be supplied for the row to be importable */
  required: boolean;
  /** Help text shown next to the field in the mapping UI */
  description?: string;
  /**
   * Additional header names that should auto-map to this field. Matched
   * case-insensitively against the actual CSV headers. The field key
   * itself and the label are also automatically considered aliases.
   */
  aliases?: string[];
}

/** Per-row outcome reported by a commit handler. */
export interface ImportRowResult {
  /** 1-based row index in the CSV (excluding header) */
  row: number;
  status: "imported" | "updated" | "skipped" | "failed";
  /** Reason for skipped/failed; ignored for imported / updated */
  message?: string;
}

/** Aggregate result returned by an import run. */
export interface ImportResult {
  imported: number;
  /** Existing rows updated in upsert mode. 0 in create-only mode. */
  updated: number;
  skipped: number;
  failed: number;
  /** Per-row outcomes for the audit log and UI display */
  rows: ImportRowResult[];
}

/**
 * Import mode. "create" (default) inserts new rows and reports duplicates
 * as skipped/failed; "upsert" matches existing rows by the importer's
 * natural key and updates them in place. The wizard exposes this as the
 * "Update existing rows on match" toggle.
 */
export type ImportMode = "create" | "upsert";

/**
 * Context passed to a commit handler. Lets the handler attribute new
 * rows to the user who triggered the import.
 */
export interface ImportContext {
  triggeredBy: string;
  /** Defaults to "create" for backwards compatibility. */
  mode?: ImportMode;
}

/**
 * An importer definition — the unit registered in the importer registry.
 * Each importer knows its fields and how to commit a batch of mapped rows.
 *
 * Adding a new importer is a single new file under src/lib/importers/importers/
 * plus a one-line addition to the registry.
 */
export interface ImporterDefinition {
  /** Unique key — used in URLs, ImportLog, and the registry lookup */
  key: string;
  /** Display name shown in the wizard list */
  name: string;
  /** Short description shown on the wizard card */
  description: string;
  /** Module key from the central modules registry that this importer maps to */
  module: string;
  /** Field schema — drives the mapping UI and validation */
  fields: ImportField[];
  /**
   * True when this importer's `commit()` honors `ctx.mode === "upsert"`
   * by matching rows on a stable natural key (name, contractNumber,
   * email, etc.) and updating in place. The wizard hides the "Update
   * existing rows" toggle for importers that don't set this so users
   * don't get silent no-op behavior. Defaults to false.
   */
  supportsUpsert?: boolean;
  /**
   * Human-readable description of the natural key used for upsert
   * matching, shown on the wizard alongside the mode toggle so users
   * know what's being matched (e.g. "Matched by contract number, then
   * (client + title) as a fallback"). Required when supportsUpsert is
   * true. Ignored otherwise.
   */
  upsertKeyDescription?: string;
  /**
   * Commit a batch of rows. Each input object is keyed by the field key
   * (post-mapping). The handler is responsible for its own validation,
   * deduplication, and DB writes. Should never throw — return failures
   * via the rows array instead.
   */
  commit(
    rows: Record<string, string>[],
    ctx: ImportContext
  ): Promise<ImportResult>;

  /**
   * Optional: supply up to a handful of real-data sample rows from the
   * database for the downloadable template. Lets users see actual valid
   * values for foreign-key-by-name columns (clientName, projectName,
   * etc.), enum values, and date formats instead of heuristic
   * placeholders. Keys must match this importer's field keys; missing
   * values fall through to empty string. Return an empty array if the
   * table has no records yet — the template falls back to a heuristic
   * row in that case.
   */
  sampleRows?(): Promise<Record<string, string>[]>;

  /**
   * Optional: supply EVERY row currently in the database in the same
   * column shape the importer expects. Powers the "Download current
   * data" button so admins can export → edit in Excel → re-upload to
   * update existing records. Only implement on importers whose
   * `commit()` supports an idempotent UPSERT (matching by a stable
   * key like email / contractNumber / name) — otherwise re-uploading
   * the export creates duplicates or thrashes.
   */
  exportRows?(): Promise<Record<string, string>[]>;
}
