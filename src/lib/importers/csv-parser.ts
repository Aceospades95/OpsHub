/**
 * Minimal CSV parser — no external dependencies.
 *
 * Handles the cases that come up in real-world CSVs from Excel, Sheets,
 * and standard exports:
 *   - Quoted fields containing commas
 *   - Quoted fields containing newlines
 *   - Escaped quotes inside quoted fields ("" → ")
 *   - LF / CRLF / CR line endings
 *   - Trimmed header row
 *   - Skips fully blank rows
 *
 * Does NOT support:
 *   - Custom delimiters (always comma)
 *   - Custom quote characters (always double-quote)
 *   - Comment lines
 *
 * That's fine for this use case. If we ever need exotic CSV support
 * we can swap in papaparse without changing call sites since this file
 * exposes a single parseCsv() function.
 */

export interface ParsedCsv {
  /** Trimmed column headers in original order */
  headers: string[];
  /** Each row as an object keyed by header. Missing values are empty strings. */
  rows: Record<string, string>[];
  /** Total non-empty rows (excluding the header) */
  rowCount: number;
}

/**
 * Parse a CSV string into headers + objects.
 *
 * Throws if the input is empty or has no header row. Per-cell parse
 * errors are silently tolerated — invalid quoted state at end-of-input
 * is treated as the end of the current value.
 */
export function parseCsv(input: string): ParsedCsv {
  if (!input || !input.trim()) {
    throw new Error("CSV is empty");
  }

  // Strip the UTF-8 byte-order mark Excel and some other tools prepend
  // when exporting "CSV UTF-8". If we leave the BOM in, the first
  // header gets a leading "﻿" and the auto-mapper misses it.
  const debommed = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;

  // Normalize line endings — handle CRLF and CR by treating both as LF
  const normalized = debommed.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  // Tokenize into rows, respecting quoted state. We can't just split on
  // \n because quoted fields might contain newlines.
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentField = "";
  let inQuotes = false;
  let i = 0;

  while (i < normalized.length) {
    const char = normalized[i];
    const next = normalized[i + 1];

    if (inQuotes) {
      if (char === '"' && next === '"') {
        // Escaped quote — append a literal " and skip the next char
        currentField += '"';
        i += 2;
        continue;
      }
      if (char === '"') {
        // End of quoted section
        inQuotes = false;
        i++;
        continue;
      }
      // Any other char inside quotes is literal, including , and \n
      currentField += char;
      i++;
      continue;
    }

    // Not in quotes
    if (char === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (char === ",") {
      currentRow.push(currentField);
      currentField = "";
      i++;
      continue;
    }
    if (char === "\n") {
      currentRow.push(currentField);
      // Skip rows that are just one empty field — Excel often appends
      // a trailing newline that we don't want to count as a row
      if (!(currentRow.length === 1 && currentRow[0] === "")) {
        rows.push(currentRow);
      }
      currentRow = [];
      currentField = "";
      i++;
      continue;
    }
    currentField += char;
    i++;
  }

  // Flush the final field/row if the file doesn't end with a newline
  if (currentField !== "" || currentRow.length > 0) {
    currentRow.push(currentField);
    if (!(currentRow.length === 1 && currentRow[0] === "")) {
      rows.push(currentRow);
    }
  }

  if (rows.length === 0) {
    throw new Error("CSV has no rows");
  }

  // First row is headers — trim each cell
  const headers = rows[0].map((h) => h.trim());
  const dataRows = rows.slice(1);

  // Map each remaining row to an object keyed by header
  const objects: Record<string, string>[] = dataRows.map((row) => {
    const obj: Record<string, string> = {};
    for (let col = 0; col < headers.length; col++) {
      const key = headers[col];
      if (!key) continue; // Skip cells under blank headers
      obj[key] = (row[col] || "").trim();
    }
    return obj;
  });

  // Filter out completely empty rows (all values blank)
  const nonEmpty = objects.filter((obj) =>
    Object.values(obj).some((v) => v !== "")
  );

  return {
    headers,
    rows: nonEmpty,
    rowCount: nonEmpty.length,
  };
}
