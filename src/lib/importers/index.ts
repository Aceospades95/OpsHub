/**
 * CSV importer infrastructure — public API.
 *
 * Re-exports the registry helpers, types, and CSV parser so consumers
 * can import everything from `@/lib/importers`.
 */

export { parseCsv } from "./csv-parser";
export { getImporter, listImporters, IMPORTERS } from "./registry";
export type {
  ImporterDefinition,
  ImportField,
  ImportRowResult,
  ImportResult,
  ImportContext,
} from "./types";
export type { ParsedCsv } from "./csv-parser";

/**
 * Auto-suggest a column → field mapping based on header names.
 *
 * For each importer field, look for a CSV header that matches:
 *   1. The field key exactly (case-insensitive)
 *   2. The field label exactly (case-insensitive)
 *   3. Any of the field's aliases (case-insensitive)
 *
 * Returns a map of importer-field-key → matched CSV header (or undefined
 * if no match was found). The wizard UI seeds the mapping form with this
 * but lets the user override.
 */
import type { ImporterDefinition } from "./types";
import type { ParsedCsv } from "./csv-parser";

export function autoMapHeaders(
  importer: ImporterDefinition,
  csv: ParsedCsv
): Record<string, string | undefined> {
  const mapping: Record<string, string | undefined> = {};
  const headersLower = csv.headers.map((h) => h.toLowerCase());

  for (const field of importer.fields) {
    const candidates = [
      field.key.toLowerCase(),
      field.label.toLowerCase(),
      ...(field.aliases || []).map((a) => a.toLowerCase()),
    ];
    const matchIndex = headersLower.findIndex((h) => candidates.includes(h));
    mapping[field.key] = matchIndex >= 0 ? csv.headers[matchIndex] : undefined;
  }

  return mapping;
}

/**
 * Apply a mapping to the parsed CSV rows, producing rows keyed by
 * importer field key (instead of CSV header). Required for handing off
 * to an importer's commit() function.
 */
export function applyMapping(
  csv: ParsedCsv,
  mapping: Record<string, string | undefined>
): Record<string, string>[] {
  return csv.rows.map((row) => {
    const mapped: Record<string, string> = {};
    for (const [fieldKey, csvHeader] of Object.entries(mapping)) {
      if (csvHeader && row[csvHeader] !== undefined) {
        mapped[fieldKey] = row[csvHeader];
      }
    }
    return mapped;
  });
}

/**
 * Generate a sample CSV template for an importer. Contains the header row
 * (using field keys as column names). When the importer implements
 * sampleRows(), the template includes up to a handful of real-data rows
 * from the live database so users can paste valid values; when no records
 * exist yet (or the importer has no sampleRows hook), it falls back to a
 * single heuristic row with plausible placeholders.
 */
export async function generateSampleCsv(importer: ImporterDefinition): Promise<string> {
  const headerLine = importer.fields.map((f) => csvEscape(f.key)).join(",");

  let dataRows: Record<string, string>[] = [];
  if (importer.sampleRows) {
    try {
      dataRows = await importer.sampleRows();
    } catch {
      // If a sampleRows() implementation throws, fall back to heuristics.
      dataRows = [];
    }
  }
  if (dataRows.length === 0) {
    dataRows = [buildHeuristicRow(importer)];
  }

  const dataLines = dataRows.map((row) =>
    importer.fields.map((f) => csvEscape(row[f.key] ?? "")).join(",")
  );

  return [headerLine, ...dataLines].join("\r\n") + "\r\n";
}

function buildHeuristicRow(importer: ImporterDefinition): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of importer.fields) {
    out[f.key] = guessValue(f, importer);
  }
  return out;
}

function guessValue(
  field: ImporterDefinition["fields"][number],
  importer: ImporterDefinition
): string {
  if (field.description?.includes("Defaults to")) {
    const match = field.description.match(/Defaults to (\w+)/);
    if (match) return match[1];
  }
  const k = field.key.toLowerCase();
  if (k.includes("email")) return "example@company.com";
  if (k.includes("date")) return "2025-01-15";
  if (k.includes("phone")) return "+1-555-0100";
  if (k.includes("url") || k.includes("website")) return "https://example.com";
  if (k.includes("cost") || k.includes("value")) return "1000";
  if (k.includes("currency")) return "USD";
  if (field.key === "name" || field.key === "title") {
    return `Sample ${importer.name.replace(/s$/, "")}`;
  }
  if (field.required) return `Example ${field.label}`;
  return "";
}

/**
 * RFC-4180 CSV field escaping. Quote when a field contains comma, quote,
 * newline, or carriage return; double embedded quotes inside the quoted
 * field. Real-data sample rows can contain any of these.
 */
function csvEscape(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/**
 * Generate a full CSV export for an importer that supports
 * `exportRows()`. Same column shape as `generateSampleCsv` (so the
 * file round-trips back through the same importer's `commit()`) but
 * dumps every row currently in the database.
 *
 * Caller is responsible for guarding against `importer.exportRows`
 * being undefined — this function returns `null` in that case so the
 * route can answer 404 with a clear message.
 */
export async function generateExportCsv(
  importer: ImporterDefinition
): Promise<string | null> {
  if (!importer.exportRows) return null;
  const headerLine = importer.fields.map((f) => csvEscape(f.key)).join(",");
  const dataRows = await importer.exportRows();
  const dataLines = dataRows.map((row) =>
    importer.fields.map((f) => csvEscape(row[f.key] ?? "")).join(",")
  );
  return [headerLine, ...dataLines].join("\r\n") + "\r\n";
}
