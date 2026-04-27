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
import type { ReportOutput, ReportColumn } from "../types";
import {
  getEntityDef,
  type ColumnDef,
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
  const where = buildWhere(report, config, includes);
  const orderBy = buildOrderBy(report, config, def, includes);
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

function buildWhere(
  _report: CustomReport,
  config: CustomReportConfig,
  includes: Set<string>
): Record<string, unknown> {
  const where: Record<string, unknown> = {};
  for (const clause of config.filters) {
    const { field, op, value } = clause;
    // Relation filters are encoded as "client.name" → { client: { name: ... } }
    const dotIdx = field.indexOf(".");
    if (dotIdx > -1) {
      const relation = field.slice(0, dotIdx);
      const sub = field.slice(dotIdx + 1);
      includes.add(relation); // ensure relation also loads for column projection
      const subClause = applyOp(op, value, "string");
      if (subClause === null) continue;
      const existing = (where[relation] as Record<string, unknown>) ?? {};
      where[relation] = { ...existing, [sub]: subClause };
      continue;
    }
    const fieldClause = applyOp(op, value, undefined);
    if (fieldClause === null) continue;
    where[field] = fieldClause;
  }
  return where;
}

/**
 * Translate one (operator, value) pair into the Prisma filter shape.
 * Returns null when the operator should produce no filter — e.g. an
 * empty value with a `contains` operator.
 */
function applyOp(
  op: FilterOperator,
  value: unknown,
  hint: string | undefined
): unknown {
  switch (op) {
    case "equals":
      return value;
    case "contains": {
      const s = String(value ?? "").trim();
      if (!s) return null;
      return { contains: s, mode: "insensitive" };
    }
    case "in": {
      const list = Array.isArray(value)
        ? value
        : String(value ?? "")
            .split(/[,;\s]+/)
            .map((s) => s.trim())
            .filter((s) => s.length > 0);
      if (list.length === 0) return null;
      return { in: list };
    }
    case "gt":
      return { gt: coerce(value, hint) };
    case "gte":
      return { gte: coerce(value, hint) };
    case "lt":
      return { lt: coerce(value, hint) };
    case "lte":
      return { lte: coerce(value, hint) };
    case "isNull":
      return { equals: null };
    case "isNotNull":
      return { not: null };
  }
  return null;
}

function coerce(value: unknown, hint: string | undefined): unknown {
  if (hint === "date" && typeof value === "string") {
    const d = new Date(value);
    return isNaN(d.getTime()) ? value : d;
  }
  if (hint === "number" && typeof value === "string") {
    const n = Number(value);
    return Number.isFinite(n) ? n : value;
  }
  return value;
}

function buildOrderBy(
  _report: CustomReport,
  config: CustomReportConfig,
  def: ReturnType<typeof getEntityDef>,
  includes: Set<string>
): Record<string, "asc" | "desc"> | undefined {
  const raw = config.sortBy ?? def.defaultSort;
  if (!raw) return undefined;
  const desc = raw.startsWith("-");
  const key = desc ? raw.slice(1) : raw;
  // Don't allow sorting through a relation — Prisma supports it but
  // the syntax is more complex and we want predictable behavior.
  // Strip the "relation.field" form back to the relation root.
  if (key.includes(".")) {
    const relation = key.split(".")[0];
    includes.add(relation);
    return { [relation]: desc ? "desc" : "asc" };
  }
  return { [key]: desc ? "desc" : "asc" };
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
