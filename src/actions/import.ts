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
  const user = await requireAuth();
  requireAdmin(user.role);

  const importerKey = formData.get("importerKey") as string;
  const importer = getImporter(importerKey);
  if (!importer) {
    return { success: false, error: `Unknown importer "${importerKey}"` };
  }

  const blob = formData.get("file");
  if (!blob || !(blob instanceof File)) {
    return { success: false, error: "No file provided" };
  }
  if (blob.size === 0) {
    return { success: false, error: "File is empty" };
  }
  if (blob.size > MAX_CSV_BYTES) {
    return {
      success: false,
      error: `File exceeds ${MAX_CSV_BYTES / 1024 / 1024}MB limit`,
    };
  }

  const text = await blob.text();
  let parsed: ParsedCsv;
  try {
    parsed = parseCsv(text);
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to parse CSV",
    };
  }

  if (parsed.rowCount === 0) {
    return { success: false, error: "CSV has no data rows" };
  }

  return {
    success: true,
    previewRows: parsed.rows.slice(0, 20),
    headers: parsed.headers,
    suggestedMapping: autoMapHeaders(importer, parsed),
    totalRows: parsed.rowCount,
  };
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
  const user = await requireAuth();
  requireAdmin(user.role);

  const importerKey = formData.get("importerKey") as string;
  const importer = getImporter(importerKey);
  if (!importer) {
    return { success: false, error: `Unknown importer "${importerKey}"` };
  }

  const blob = formData.get("file");
  if (!blob || !(blob instanceof File)) {
    return { success: false, error: "No file provided" };
  }
  if (blob.size > MAX_CSV_BYTES) {
    return {
      success: false,
      error: `File exceeds ${MAX_CSV_BYTES / 1024 / 1024}MB limit`,
    };
  }

  const mappingRaw = formData.get("mapping") as string;
  let mapping: Record<string, string | undefined>;
  try {
    mapping = JSON.parse(mappingRaw);
  } catch {
    return { success: false, error: "Invalid mapping payload" };
  }

  // Required-field check on the mapping itself
  const missingRequired = importer.fields
    .filter((f) => f.required && !mapping[f.key])
    .map((f) => f.label);
  if (missingRequired.length > 0) {
    return {
      success: false,
      error: `Missing required field mapping: ${missingRequired.join(", ")}`,
    };
  }

  const text = await blob.text();
  let parsed: ParsedCsv;
  try {
    parsed = parseCsv(text);
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to parse CSV",
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

  // Persist the result for audit
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

  revalidatePath("/admin/import");
  // The importer wrote new rows somewhere — revalidate that module's
  // pages so the new data shows up immediately. Conservative: revalidate
  // the layout so every page picks up new entities.
  revalidatePath("/", "layout");

  return {
    success: true,
    imported: result.imported,
    skipped: result.skipped,
    failed: result.failed,
    rowOutcomes: result.rows.slice(0, 100), // cap response size
    logId: log.id,
  };
}
