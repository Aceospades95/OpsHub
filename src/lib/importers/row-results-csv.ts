/**
 * Row-results CSV builder — powers the "Download row results (CSV)"
 * buttons on the wizard result screen and the import-log detail page.
 *
 * Deliberately a standalone leaf module with NO imports from the rest
 * of the importer framework: both call sites are client components,
 * and pulling in ./index would drag the registry (and Prisma) into the
 * client bundle.
 */

export interface RowResultLite {
  row: number;
  status: string;
  message?: string;
  warnings?: string[];
}

/**
 * Build a `row,status,message,warnings` CSV covering every outcome.
 * Multiple warnings on a row are joined with "; " into one cell.
 */
export function buildRowResultsCsv(outcomes: RowResultLite[]): string {
  const lines = [["row", "status", "message", "warnings"].join(",")];
  for (const o of outcomes) {
    lines.push(
      [
        csvEscape(String(o.row)),
        csvEscape(o.status),
        csvEscape(o.message ?? ""),
        csvEscape((o.warnings ?? []).join("; ")),
      ].join(",")
    );
  }
  return lines.join("\r\n") + "\r\n";
}

/**
 * RFC-4180 escaping + spreadsheet-formula-injection guard — same rules
 * as the template/export CSV builder in ./index (kept separate so this
 * module stays client-safe).
 */
function csvEscape(value: string): string {
  if (/^[=+\-@\t\r]/.test(value) && !/^-?\d+(\.\d+)?$/.test(value)) {
    value = `'${value}`;
  }
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}
