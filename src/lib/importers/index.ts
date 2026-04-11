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
