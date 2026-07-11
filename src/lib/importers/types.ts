/**
 * Shared types for the CSV importer infrastructure.
 *
 * Same shape as the email/storage/jobs/notifications layers: definitions
 * live in a registry, a single commit() entry point handles writes +
 * audit logging, and an admin wizard surfaces the per-importer flow.
 */

import type { Prisma, PrismaClient } from "@prisma/client";

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
  /**
   * Non-fatal issues on a row that still imported/updated: a dropped
   * foreign-key link (unresolved projectName / clientName /
   * assigneeEmail / parent link / …) or an invalid enum value coerced
   * to a default. The row is written, but the operator should know
   * the data isn't exactly what the CSV said.
   */
  warnings?: string[];
}

/** Aggregate result returned by an import run. */
export interface ImportResult {
  imported: number;
  /** Existing rows updated in upsert / update / fill-blanks mode. */
  updated: number;
  skipped: number;
  failed: number;
  /**
   * Rows written (imported or updated) WITH at least one warning.
   * Subset of imported + updated, not an additional bucket.
   */
  warnings: number;
  /** Per-row outcomes for the audit log and UI display */
  rows: ImportRowResult[];
}

/**
 * Import mode — how a row that matches an existing record (by the
 * importer's natural key) is handled:
 *
 *   create       existing matches are SKIPPED ("already exists");
 *                only new rows are inserted.
 *   update       rows with NO existing match are SKIPPED ("no existing
 *                record"); matches are updated in place.
 *   upsert       create + full update (the wizard default).
 *   fill-blanks  like upsert, but an UPDATE only writes fields whose
 *                incoming value is non-empty AND whose existing value
 *                is null/empty — existing data is never overwritten.
 *                Creates behave exactly like create.
 *
 * Importers should route the decision through `applyMode()` (and
 * `mergeFillBlanks()` for the fill-blanks update payload) from
 * ./helpers instead of hand-rolling mode checks.
 */
export type ImportMode = "create" | "update" | "upsert" | "fill-blanks";

/**
 * The Prisma client handed to commit handlers. A plain PrismaClient on
 * real commits; a transaction client on preview runs (the preview
 * action wraps commit() in a transaction it always rolls back, so
 * nothing an importer writes through ctx.db survives a preview).
 */
export type ImportDb = Prisma.TransactionClient | PrismaClient;

/**
 * Context passed to a commit handler. Lets the handler attribute new
 * rows to the user who triggered the import, and carries the DB
 * client every read/write inside commit() MUST go through (never the
 * global db — previews rely on ctx.db being a rolled-back
 * transaction).
 */
export interface ImportContext {
  triggeredBy: string;
  /** Defaults to "create" for backwards compatibility. */
  mode?: ImportMode;
  /**
   * Prisma client for ALL reads + writes inside commit(). Real commits
   * receive the global client; previews receive a transaction client
   * that is rolled back after commit() returns.
   */
  db: ImportDb;
  /**
   * True when this run is a dry-run preview. Importers must gate any
   * side effect that does NOT go through ctx.db (workflow triggers,
   * emails, …) on this flag so previews leak nothing.
   */
  isPreview?: boolean;
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
   * True when this importer's `commit()` honors the full `ctx.mode`
   * contract (create / update / upsert / fill-blanks) by matching rows
   * on a stable natural key (name, contractNumber, email, etc.). The
   * wizard hides the mode selector for importers that don't set this
   * so users don't get silent no-op behavior. Defaults to false.
   */
  supportsUpsert?: boolean;
  /**
   * Human-readable description of the natural key used for upsert
   * matching, shown on the wizard alongside the mode selector so users
   * know what's being matched (e.g. "Matched by contract number, then
   * (client + title) as a fallback"). Required when supportsUpsert is
   * true. Ignored otherwise.
   */
  upsertKeyDescription?: string;
  /**
   * Commit a batch of rows. Each input object is keyed by the field key
   * (post-mapping). The handler is responsible for its own validation,
   * deduplication, and DB writes — all through ctx.db. Should never
   * throw — return failures via the rows array instead.
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
