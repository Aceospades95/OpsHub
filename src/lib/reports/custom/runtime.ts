/**
 * Runtime for admin-built custom reports.
 *
 * Reads a saved CustomReport row, walks the entity registry to build
 * a Prisma `where` + `orderBy` + `take`, fires the entity's `fetch`,
 * then maps the result rows down to the selected columns. The output
 * shape matches the existing `ReportOutput` type so any consumer that
 * already knows how to render a registered report (CSV, HTML, email
 * digest) can render a custom report unchanged.
 */

import { db } from "@/lib/db";
import { log } from "@/lib/log";
import type { ReportOutput, ReportColumn } from "../types";
import {
  getEntityDef,
  type ColumnDef,
  type EntityDef,
  type FieldType,
  type FilterDef,
  type FilterOperator,
} from "./entities";
import type { CustomReport } from "@prisma/client";

export interface CustomReportFilter {
  field: string;
  op: FilterOperator;
  value?: unknown;
}

export interface CustomReportConfig {
  columns: string[];
  filters: CustomReportFilter[];
  /** Sort key (column key, prefix "-" for desc). */
  sortBy?: string | null;
  /** Hard cap on rows; defaults to the entity's defaultLimit. */
  limit?: number | null;
}

export function parseConfig(report: CustomReport): CustomReportConfig {
  let columns: string[] = [];
  let filters: CustomReportFilter[] = [];
  try {
    columns = JSON.parse(report.columns) as string[];
  } catch {
    columns = [];
  }
  try {
    filters = JSON.parse(report.filters) as CustomReportFilter[];
  } catch {
    filters = [];
  }
  return {
    columns,
    filters,
    sortBy: report.sortBy,
    limit: report.limit,
  };
}

/**
 * Run a saved custom report and produce a ReportOutput compatible
 * with the existing renderer / email-digest code paths.
 */
export async function runCustomReport(reportId: string): Promise<ReportOutput> {
  const report = await db.customReport.findUnique({ where: { id: reportId } });
  if (!report) {
    throw new Error(`Custom report ${reportId} not found`);
  }
  return runCustomReportFromRow(report);
}

export async function runCustomReportFromRow(
  report: CustomReport
): Promise<ReportOutput> {
  const def = getEntityDef(report.entityType);
  const config = parseConfig(report);

  const columnKeys =
    config.columns.length > 0 ? config.columns : def.defaultColumns;

  // Resolve each column key to its registry entry. Unknown keys are
  // dropped silently — admins might delete a column from the registry
  // and we don't want stale saves to crash.
  const selectedColumns = columnKeys
    .map((k) => def.columns.find((c) => c.key === k))
    .filter((c): c is ColumnDef => c != null);

  // Auto-include any relations referenced by selected columns or
  // filter clauses. Keeps the query self-contained and consistent
  // regardless of which columns the admin picked.
  const includes = new Set<string>();
  for (const c of selectedColumns) {
    if (c.requiresRelation) includes.add(c.requiresRelation);
  }
  const where = buildWhere(config, def, includes);
  const orderBy = buildOrderBy(config, def, includes);
  const take = Math.min(
    Math.max(1, config.limit ?? def.defaultLimit),
    5000
  );

  const rows = await def.fetch({ where, orderBy, take, includes });

  // Map columns + raw rows into the renderer's expected shape:
  //   columns: { key, label, format }
  //   rows:    flat objects keyed by column key
  const renderColumns: ReportColumn[] = selectedColumns.map((c) => ({
    key: c.key,
    label: c.label,
    align:
      c.type === "number"
        ? "right"
        : c.type === "date"
          ? "right"
          : "left",
    format: c.format,
  }));
  const renderRows = rows.map((row) => {
    const out: Record<string, unknown> = {};
    for (const c of selectedColumns) {
      out[c.key] = readDotPath(row, c.key);
    }
    return out;
  });

  const summary = `${rows.length} ${rows.length === 1 ? "row" : "rows"}`;
  return {
    summary,
    columns: renderColumns,
    rows: renderRows,
    emptyMessage: `No ${def.label.toLowerCase()} match this report's filters.`,
  };
}

// ─── where / orderBy builders ─────────────────────────────────────────
//
// Exported for unit testing. These are pure functions of (config + def)
// — no DB access — so they belong in a test that exercises edge cases
// (unknown field, mismatched operator, malformed value) directly.

export {
  buildWhere as _testBuildWhere,
  buildOrderBy as _testBuildOrderBy,
  coerce as _testCoerceFilterValue,
};


/**
 * Build the Prisma `where` for a saved report.
 *
 * Every filter is routed through the entity's registered FilterDef
 * list — saved filters that reference an unknown field, use an
 * operator the field doesn't expose, or carry a value that doesn't
 * coerce to the field's declared type are dropped silently. Without
 * this, an admin who hand-edits the JSON (or a stale saved report from
 * before a registry change) can:
 *
 *   - filter on fields that aren't supposed to be exposed (e.g.
 *     `hashedPassword`)
 *   - send a `gt` against a string column and crash the query with a
 *     cryptic Prisma error
 *   - pass `"true"` / `"2024-01-01"` as untyped strings and silently
 *     never match
 */
function buildWhere(
  config: CustomReportConfig,
  def: EntityDef,
  includes: Set<string>
): Record<string, unknown> {
  const filterByKey = new Map<string, FilterDef>(
    def.filters.map((f) => [f.key, f])
  );

  const where: Record<string, unknown> = {};
  for (const clause of config.filters) {
    const filterDef = filterByKey.get(clause.field);
    if (!filterDef) {
      log.warn("custom-reports.where", "Dropped filter on unknown field", {
        field: clause.field,
      });
      continue;
    }
    if (!filterDef.operators.includes(clause.op)) {
      log.warn("custom-reports.where", "Dropped unsupported operator", {
        field: clause.field,
        op: clause.op,
        allowed: filterDef.operators,
      });
      continue;
    }
    const subClause = applyOp(clause.op, clause.value, filterDef);
    if (subClause === null) continue;

    // Relation filters are encoded as "client.name" → { client: { name: ... } }
    const dotIdx = clause.field.indexOf(".");
    if (dotIdx > -1) {
      const relation = clause.field.slice(0, dotIdx);
      const sub = clause.field.slice(dotIdx + 1);
      includes.add(relation); // ensure relation also loads for column projection
      const existing = (where[relation] as Record<string, unknown>) ?? {};
      where[relation] = { ...existing, [sub]: subClause };
      continue;
    }
    where[clause.field] = subClause;
  }
  return where;
}

/**
 * Translate one (operator, value) pair into the Prisma filter shape.
 *
 * Returns null when the operator should produce no filter — e.g. an
 * empty value with `contains`, or a value that fails type coercion
 * (`gte` on a date column with an unparseable string).
 */
function applyOp(
  op: FilterOperator,
  value: unknown,
  def: FilterDef
): unknown {
  switch (op) {
    case "equals": {
      const c = coerce(value, def);
      // Drop `equals` filters with a missing/empty value; the UI uses
      // an empty value to mean "don't filter" rather than "is empty
      // string." Use `isNull` for that.
      if (c === null || c === undefined || c === "") return null;
      return c;
    }
    case "contains": {
      const s = String(value ?? "").trim();
      if (!s) return null;
      return { contains: s, mode: "insensitive" };
    }
    case "in": {
      const raw = Array.isArray(value)
        ? value
        : String(value ?? "")
            .split(/[,;\s]+/)
            .map((s) => s.trim())
            .filter((s) => s.length > 0);
      const coerced = raw
        .map((v) => coerce(v, def))
        .filter((v): v is string | number | boolean | Date => v !== null && v !== undefined);
      if (coerced.length === 0) return null;
      return { in: coerced };
    }
    case "gt": {
      const c = coerce(value, def);
      return c === null ? null : { gt: c };
    }
    case "gte": {
      const c = coerce(value, def);
      return c === null ? null : { gte: c };
    }
    case "lt": {
      const c = coerce(value, def);
      return c === null ? null : { lt: c };
    }
    case "lte": {
      const c = coerce(value, def);
      return c === null ? null : { lte: c };
    }
    case "isNull":
      return { equals: null };
    case "isNotNull":
      return { not: null };
  }
  return null;
}

/**
 * Coerce a raw filter value to the field's declared type.
 *
 *   string  — passed through after String()
 *   number  — string→Number, finite check; returns null if NaN
 *   date    — string→Date, valid-date check; returns null on invalid
 *   boolean — "true"/"1"/true → true; "false"/"0"/""/null → false;
 *             everything else → null
 *   enum    — must be a string in the field's enumValues whitelist
 *
 * null is returned for "couldn't coerce" so callers can drop the whole
 * filter rather than feed Prisma a bogus value.
 */
function coerce(value: unknown, def: FilterDef): string | number | boolean | Date | null {
  const t: FieldType = def.type;
  if (value === null || value === undefined) return null;

  if (t === "number") {
    const n = typeof value === "number" ? value : Number(String(value));
    return Number.isFinite(n) ? n : null;
  }
  if (t === "date") {
    if (value instanceof Date) {
      return isNaN(value.getTime()) ? null : value;
    }
    const d = new Date(String(value));
    return isNaN(d.getTime()) ? null : d;
  }
  if (t === "boolean") {
    if (typeof value === "boolean") return value;
    const s = String(value).trim().toLowerCase();
    if (s === "true" || s === "1" || s === "yes") return true;
    if (s === "false" || s === "0" || s === "no" || s === "") return false;
    return null;
  }
  if (t === "enum") {
    const s = String(value);
    if (def.enumValues && def.enumValues.length > 0 && !def.enumValues.includes(s)) {
      return null;
    }
    return s;
  }
  // string
  return String(value);
}

/**
 * Build the Prisma `orderBy`.
 *
 * Sort key must resolve to a registered column — otherwise an admin
 * with raw JSON access could sort users by `hashedPassword`. The
 * default falls back to the entity's `defaultSort` when the saved
 * sortBy points at a no-longer-registered column, then null when no
 * default exists either.
 */
function buildOrderBy(
  config: CustomReportConfig,
  def: EntityDef,
  includes: Set<string>
): Record<string, "asc" | "desc" | Record<string, "asc" | "desc">> | undefined {
  const columnKeys = new Set(def.columns.map((c) => c.key));

  const raw = parseSortKey(config.sortBy, def, columnKeys);
  if (!raw) return undefined;
  const { key, desc } = raw;

  // Relation sorts ("client.name") need Prisma's NESTED form —
  // `{ client: { name: "desc" } }`. The old code stripped to the
  // relation root (`{ client: "desc" }`), which Prisma rejects for
  // to-one relations, so every saved report sorted by a relation
  // column errored at run time (QA sweep finding). The builder UI no
  // longer offers relation sorts, but stale saved reports must keep
  // working.
  if (key.includes(".")) {
    const [relation, subField] = key.split(".");
    if (!subField) return undefined;
    includes.add(relation);
    return { [relation]: { [subField]: desc ? "desc" : "asc" } };
  }
  return { [key]: desc ? "desc" : "asc" };
}

function parseSortKey(
  rawSort: string | null | undefined,
  def: EntityDef,
  columnKeys: Set<string>
): { key: string; desc: boolean } | null {
  function tryParse(s: string | null | undefined): { key: string; desc: boolean } | null {
    if (!s) return null;
    const desc = s.startsWith("-");
    const key = desc ? s.slice(1) : s;
    return columnKeys.has(key) ? { key, desc } : null;
  }
  return tryParse(rawSort) ?? tryParse(def.defaultSort);
}

// ─── Read dot-paths from row objects ────────────────────────────────────

function readDotPath(obj: unknown, path: string): unknown {
  const parts = path.split(".");
  let cur: unknown = obj;
  for (const p of parts) {
    if (cur && typeof cur === "object" && p in cur) {
      cur = (cur as Record<string, unknown>)[p];
    } else {
      return null;
    }
  }
  return cur;
}
