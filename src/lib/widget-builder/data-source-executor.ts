import { db } from "@/lib/db";
import { getDataSource } from "./data-source-registry";
import type { FilterConfig, AggregationType } from "./widget-config-types";

const MAX_LIMIT = 100;

interface QueryConfig {
  dataSourceId: string;
  filters: FilterConfig[];
  sort: { field: string; direction: "asc" | "desc" };
  limit: number;
  aggregation?: { type: AggregationType; field?: string; groupByField?: string };
}

interface QueryResult {
  rows: Record<string, unknown>[];
  aggregate?: number | Record<string, number>;
}

function buildWhere(filters: FilterConfig[]): Record<string, unknown> {
  const where: Record<string, unknown> = {};
  for (const f of filters) {
    switch (f.operator) {
      case "equals": where[f.field] = f.value; break;
      case "contains": where[f.field] = { contains: f.value, mode: "insensitive" }; break;
      case "gt": where[f.field] = { gt: f.value }; break;
      case "gte": where[f.field] = { gte: f.value }; break;
      case "lt": where[f.field] = { lt: f.value }; break;
      case "lte": where[f.field] = { lte: f.value }; break;
      case "in": where[f.field] = { in: Array.isArray(f.value) ? f.value : [f.value] }; break;
      case "notIn": where[f.field] = { notIn: Array.isArray(f.value) ? f.value : [f.value] }; break;
      case "isNull": where[f.field] = null; break;
      case "isNotNull": where[f.field] = { not: null }; break;
    }
  }
  return where;
}

function buildIncludes(dataSourceId: string): Record<string, unknown> {
  const ds = getDataSource(dataSourceId);
  if (!ds) return {};
  const includes: Record<string, unknown> = {};
  for (const field of ds.fields) {
    if (field.relation) {
      includes[field.key] = { select: { [field.relation.displayField]: true } };
    }
  }
  return includes;
}

// Flatten relation fields for display: { client: { name: "Acme" } } → { client: "Acme" }
function flattenRow(row: Record<string, unknown>, dataSourceId: string): Record<string, unknown> {
  const ds = getDataSource(dataSourceId);
  if (!ds) return row;
  const flat = { ...row };
  for (const field of ds.fields) {
    if (field.relation && flat[field.key] && typeof flat[field.key] === "object") {
      const rel = flat[field.key] as Record<string, unknown>;
      flat[field.key] = rel[field.relation.displayField] ?? null;
    }
  }
  return flat;
}

// Models that carry the soft-delete `deletedAt` column. We inject
// `deletedAt: null` into every widget query so soft-deleted rows stay
// out of dashboards.
const SOFT_DELETE_DATA_SOURCES = new Set([
  "client",
  "project",
  "task",
  "contract",
  "document",
  "supplier",
  "certification",
]);

function withSoftDeleteFilter(
  dataSourceId: string,
  where: Record<string, unknown>,
): Record<string, unknown> {
  if (!SOFT_DELETE_DATA_SOURCES.has(dataSourceId)) return where;
  return { ...where, deletedAt: null };
}

async function queryModel(
  dataSourceId: string,
  where: Record<string, unknown>,
  orderBy: Record<string, string>,
  take: number,
  include: Record<string, unknown>,
): Promise<Record<string, unknown>[]> {
  const filteredWhere = withSoftDeleteFilter(dataSourceId, where);
  const args = { where: filteredWhere, orderBy, take, include: Object.keys(include).length > 0 ? include : undefined };

  switch (dataSourceId) {
    case "client": return db.client.findMany(args as Parameters<typeof db.client.findMany>[0]) as unknown as Record<string, unknown>[];
    case "project": return db.project.findMany(args as Parameters<typeof db.project.findMany>[0]) as unknown as Record<string, unknown>[];
    case "task": return db.task.findMany(args as Parameters<typeof db.task.findMany>[0]) as unknown as Record<string, unknown>[];
    case "contract": return db.contract.findMany(args as Parameters<typeof db.contract.findMany>[0]) as unknown as Record<string, unknown>[];
    case "milestone": return db.milestone.findMany(args as Parameters<typeof db.milestone.findMany>[0]) as unknown as Record<string, unknown>[];
    case "user": return db.user.findMany(args as Parameters<typeof db.user.findMany>[0]) as unknown as Record<string, unknown>[];
    case "document": return db.document.findMany(args as Parameters<typeof db.document.findMany>[0]) as unknown as Record<string, unknown>[];
    case "supplier": return db.supplier.findMany(args as Parameters<typeof db.supplier.findMany>[0]) as unknown as Record<string, unknown>[];
    case "certification": return db.certification.findMany(args as Parameters<typeof db.certification.findMany>[0]) as unknown as Record<string, unknown>[];
    case "activityLog": return db.activityLog.findMany(args as Parameters<typeof db.activityLog.findMany>[0]) as unknown as Record<string, unknown>[];
    default: return [];
  }
}

async function countModel(dataSourceId: string, where: Record<string, unknown>): Promise<number> {
  const w = withSoftDeleteFilter(dataSourceId, where) as never;
  switch (dataSourceId) {
    case "client": return db.client.count({ where: w });
    case "project": return db.project.count({ where: w });
    case "task": return db.task.count({ where: w });
    case "contract": return db.contract.count({ where: w });
    case "milestone": return db.milestone.count({ where: w });
    case "user": return db.user.count({ where: w });
    case "document": return db.document.count({ where: w });
    case "supplier": return db.supplier.count({ where: w });
    case "certification": return db.certification.count({ where: w });
    case "activityLog": return db.activityLog.count({ where: w });
    default: return 0;
  }
}

export async function executeDataSourceQuery(config: QueryConfig): Promise<QueryResult> {
  const ds = getDataSource(config.dataSourceId);
  if (!ds) return { rows: [] };

  const where = buildWhere(config.filters);
  const take = Math.min(config.limit || 20, MAX_LIMIT);
  const orderBy = { [config.sort.field]: config.sort.direction };
  const include = buildIncludes(config.dataSourceId);

  // Aggregation mode
  if (config.aggregation) {
    const { type, field, groupByField } = config.aggregation;

    if (type === "count") {
      const count = await countModel(config.dataSourceId, where);
      return { rows: [], aggregate: count };
    }

    if (type === "countByField" && groupByField) {
      // Get all rows and count in JS (Prisma groupBy is complex across models)
      const rows = await queryModel(config.dataSourceId, where, orderBy, MAX_LIMIT, {});
      const counts: Record<string, number> = {};
      for (const row of rows) {
        const val = String(row[groupByField] ?? "Unknown");
        counts[val] = (counts[val] || 0) + 1;
      }
      return { rows: [], aggregate: counts };
    }

    if ((type === "sum" || type === "avg" || type === "min" || type === "max") && field) {
      const rows = await queryModel(config.dataSourceId, where, orderBy, MAX_LIMIT, {});
      const values = rows.map((r) => Number(r[field]) || 0);
      let result = 0;
      if (type === "sum") result = values.reduce((a, b) => a + b, 0);
      else if (type === "avg") result = values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : 0;
      else if (type === "min") result = values.length > 0 ? Math.min(...values) : 0;
      else if (type === "max") result = values.length > 0 ? Math.max(...values) : 0;
      return { rows: [], aggregate: Math.round(result * 100) / 100 };
    }

    // Fallback
    const count = await countModel(config.dataSourceId, where);
    return { rows: [], aggregate: count };
  }

  // List mode
  const rows = await queryModel(config.dataSourceId, where, orderBy, take, include);
  return { rows: rows.map((r) => flattenRow(r, config.dataSourceId)) };
}
