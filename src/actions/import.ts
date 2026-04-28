"use server";

import { db } from "@/lib/db";
import { requireAuth } from "@/lib/permissions";
import {
  parseCsv,
  getImporter,
  autoMapHeaders,
  applyMapping,
  type ParsedCsv,
} from "@/lib/importers";
import { revalidatePath } from "next/cache";

function requireAdmin(role: string) {
  if (role !== "ADMIN") throw new Error("Admin access required");
}

const MAX_CSV_BYTES = 10 * 1024 * 1024; // 10 MB

/**
 * What the FormData entry looks like when the browser uploads a File.
 *
 * We avoid `instanceof File` for the type narrowing here because `File`
 * isn't a global in Node 18 (it lives on `node:buffer` from 18.13 but
 * isn't exposed on globalThis). The Dockerfile pins node:18-slim so
 * `instanceof File` throws a ReferenceError at runtime. Structural
 * duck-typing covers both Node 18 and Node 20+ without that risk.
 */
interface UploadedFile {
  name: string;
  size: number;
  type: string;
  text(): Promise<string>;
  arrayBuffer(): Promise<ArrayBuffer>;
}

function asUploadedFile(value: unknown): UploadedFile | null {
  if (!value || typeof value !== "object") return null;
  if (typeof value === "string") return null;
  const v = value as Record<string, unknown>;
  if (typeof v.name !== "string") return null;
  if (typeof v.size !== "number") return null;
  if (typeof v.text !== "function") return null;
  if (typeof v.arrayBuffer !== "function") return null;
  return value as unknown as UploadedFile;
}

interface PreviewResponse {
  success: boolean;
  error?: string;
  /** First N rows of the parsed CSV (capped) */
  previewRows?: Record<string, string>[];
  /** Original headers in the CSV */
  headers?: string[];
  /** Suggested field-key → csv-header mapping */
  suggestedMapping?: Record<string, string | undefined>;
  /** Total rows parsed (across the whole file, not just preview) */
  totalRows?: number;
}

/**
 * Parse a CSV upload and return the suggested column mapping + a preview
 * of the first 20 rows. Does NOT write any data to the DB — just inspects
 * the file so the wizard UI can show what's about to be imported.
 *
 * The wizard then calls commitImport() with the user-confirmed mapping
 * to actually run the importer.
 */
export async function previewImport(
  _prev: unknown,
  formData: FormData
): Promise<PreviewResponse> {
  // Top-level try/catch so any unexpected throw lands as a clean
  // { success: false, error: ... } in the wizard banner instead of
  // bubbling out as a Next.js 500 error page. Without this, a stale
  // session, a transient DB hiccup, or a Prisma-client/schema drift
  // surfaces as the cryptic "Application error: a server-side
  // exception has occurred" page that's impossible to diagnose
  // without server logs.
  try {
    const user = await requireAuth();
    requireAdmin(user.role);

    const importerKey = formData.get("importerKey") as string;
    const importer = getImporter(importerKey);
    if (!importer) {
      return { success: false, error: `Unknown importer "${importerKey}"` };
    }

    const blob = asUploadedFile(formData.get("file"));
    if (!blob) {
      return {
        success: false,
        error:
          "No file received. Pick a CSV file from the upload box and try again.",
      };
    }
    if (blob.size === 0) {
      return {
        success: false,
        error: "The file is empty. Make sure your CSV has a header row and at least one data row, then try again.",
      };
    }
    if (blob.size > MAX_CSV_BYTES) {
      return {
        success: false,
        error: `File is ${(blob.size / 1024 / 1024).toFixed(1)}MB which exceeds the ${MAX_CSV_BYTES / 1024 / 1024}MB limit. Split the import into smaller files (no more than ~50,000 rows each) or contact an administrator if you need the limit raised.`,
      };
    }

    const text = await blob.text();
    let parsed: ParsedCsv;
    try {
      parsed = parseCsv(text);
    } catch (err) {
      return {
        success: false,
        error:
          err instanceof Error
            ? `Could not parse this file as CSV: ${err.message}. If you exported from Excel, choose "CSV UTF-8" as the format.`
            : "Could not parse this file as CSV. Check the file encoding and try again.",
      };
    }

    if (parsed.rowCount === 0) {
      return {
        success: false,
        error:
          "The file has a header row but no data rows. Add at least one row of data, save, and re-upload.",
      };
    }

    return {
      success: true,
      previewRows: parsed.rows.slice(0, 20),
      headers: parsed.headers,
      suggestedMapping: autoMapHeaders(importer, parsed),
      totalRows: parsed.rowCount,
    };
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[import] previewImport threw:", err);
    return {
      success: false,
      error:
        err instanceof Error
          ? `Could not parse upload: ${err.message}`
          : "Unexpected error parsing upload",
    };
  }
}

interface CommitResponse {
  success: boolean;
  error?: string;
  imported?: number;
  skipped?: number;
  failed?: number;
  rowOutcomes?: { row: number; status: string; message?: string }[];
  logId?: string;
}

/**
 * Commit a CSV import. Parses the file again (since the preview is held
 * client-side and we don't trust the parsed rows to round-trip safely
 * through FormData), applies the user-supplied mapping, runs the
 * importer's commit handler, and records the run in ImportLog.
 *
 * Mapping is supplied as JSON in the `mapping` form field — keys are
 * importer field keys, values are CSV header names. Fields with no
 * mapping are left empty in the input rows.
 */
export async function commitImport(
  _prev: unknown,
  formData: FormData
): Promise<CommitResponse> {
  // Same defensive wrapper as previewImport — any throw from
  // requireAuth / Prisma / revalidatePath surfaces as a graceful
  // wizard error instead of a 500 page.
  try {
    const user = await requireAuth();
    requireAdmin(user.role);

    const importerKey = formData.get("importerKey") as string;
    const importer = getImporter(importerKey);
    if (!importer) {
      return { success: false, error: `Unknown importer "${importerKey}"` };
    }

    const blob = asUploadedFile(formData.get("file"));
    if (!blob) {
      return {
        success: false,
        error:
          "The upload form lost the file between preview and import. Click 'Start over' and pick the file again.",
      };
    }
    if (blob.size > MAX_CSV_BYTES) {
      return {
        success: false,
        error: `File is ${(blob.size / 1024 / 1024).toFixed(1)}MB which exceeds the ${MAX_CSV_BYTES / 1024 / 1024}MB limit.`,
      };
    }

    const mappingRaw = formData.get("mapping") as string;
    let mapping: Record<string, string | undefined>;
    try {
      mapping = JSON.parse(mappingRaw);
    } catch {
      return {
        success: false,
        error: "Internal error: column mapping was malformed. Click 'Start over' and try again.",
      };
    }

    // Required-field check on the mapping itself.
    const missingRequired = importer.fields
      .filter((f) => f.required && !mapping[f.key])
      .map((f) => f.label);
    if (missingRequired.length > 0) {
      return {
        success: false,
        error: `Required column${missingRequired.length === 1 ? "" : "s"} ${missingRequired.map((l) => `"${l}"`).join(", ")} ${missingRequired.length === 1 ? "isn't" : "aren't"} mapped. Pick the matching CSV header in the dropdown above each unmapped field, then click Import again.`,
      };
    }

    const text = await blob.text();
    let parsed: ParsedCsv;
    try {
      parsed = parseCsv(text);
    } catch (err) {
      return {
        success: false,
        error:
          err instanceof Error
            ? `Could not parse this file as CSV: ${err.message}.`
            : "Could not parse this file as CSV.",
      };
    }

    const mappedRows = applyMapping(parsed, mapping);

    let result;
    try {
      result = await importer.commit(mappedRows, { triggeredBy: user.id });
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : "Importer commit failed",
      };
    }

    // Persist the result for audit. If THIS write fails (e.g., the
    // ImportLog table is missing because a migration didn't run), we
    // don't want to wipe out the import success — return what
    // succeeded with a soft warning, log the error server-side so an
    // operator can fix the migration drift.
    let logId: string | undefined;
    try {
      const log = await db.importLog.create({
        data: {
          importerKey,
          filename: blob.name,
          rowCount: parsed.rowCount,
          imported: result.imported,
          skipped: result.skipped,
          errors:
            result.failed > 0 || result.rows.some((r) => r.status !== "imported")
              ? JSON.stringify(
                  result.rows
                    .filter((r) => r.status !== "imported")
                    .map((r) => ({ row: r.row, status: r.status, message: r.message }))
                )
              : null,
          triggeredBy: user.id,
        },
      });
      logId = log.id;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[import] Failed to write ImportLog row:", err);
    }

    // Same defensive wrapper around revalidate — known to throw in
    // some Next.js 14 setups when a layout has dynamic config drift.
    try {
      revalidatePath("/admin/import");
      revalidatePath("/", "layout");
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[import] revalidatePath threw post-import:", err);
    }

    return {
      success: true,
      imported: result.imported,
      skipped: result.skipped,
      failed: result.failed,
      rowOutcomes: result.rows.slice(0, 100), // cap response size
      logId,
    };
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[import] commitImport threw:", err);
    return {
      success: false,
      error:
        err instanceof Error
          ? `Could not import: ${err.message}`
          : "Unexpected error during import",
    };
  }
}
