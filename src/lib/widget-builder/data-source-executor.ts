import { db } from "@/lib/db";
import { HR_SENSITIVE_ENTITY_TYPES } from "@/lib/activity";
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

/**
 * Field allowlisting. Filter / sort / aggregation field names come from
 * persisted widget config (and, for previews, straight from the builder
 * client), so they must never reach Prisma unchecked — an arbitrary
 * field name would let a widget filter or sort on any column of the
 * model (e.g. boolean-exfiltrate `user.hashedPassword` via `contains`).
 * Only scalar (non-relation) fields registered in the data-source
 * registry are queryable.
 */
function scalarFieldKeys(dataSourceId: string): Set<string> {
  const ds = getDataSource(dataSourceId);
  if (!ds) return new Set();
  return new Set(ds.fields.filter((f) => !f.relation).map((f) => f.key));
}

function buildWhere(dataSourceId: string, filters: FilterConfig[]): Record<string, unknown> {
  const allowed = scalarFieldKeys(dataSourceId);
  const where: Record<string, unknown> = {};
  for (const f of filters) {
    if (!allowed.has(f.field)) continue;
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

/**
 * Resolve the sort field to a registry-listed scalar, falling back to
 * the data source's default sort when the configured field isn't
 * queryable.
 */
function buildOrderBy(
  dataSourceId: string,
  sort: { field: string; direction: "asc" | "desc" }
): Record<string, string> {
  const ds = getDataSource(dataSourceId);
  if (ds && !scalarFieldKeys(dataSourceId).has(sort.field)) {
    return { [ds.defaultSort.field]: ds.defaultSort.direction };
  }
  return { [sort.field]: sort.direction };
}

/**
 * Explicit projection built from the registry. findMany without a
 * `select` returns every column of the model — for the `user` data
 * source that previously included `hashedPassword`, serialized to any
 * dashboard viewer of a published widget. `id` is always included so
 * renderers have a stable row key.
 */
function buildSelect(dataSourceId: string): Record<string, unknown> {
  const ds = getDataSource(dataSourceId);
  if (!ds) return { id: true };
  const select: Record<string, unknown> = { id: true };
  for (const field of ds.fields) {
    select[field.key] = field.relation
      ? { select: { [field.relation.displayField]: true } }
      : true;
  }
  return select;
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
): Promise<Record<string, unknown>[]> {
  const filteredWhere = withSoftDeleteFilter(dataSourceId, where);
  const args = { where: filteredWhere, orderBy, take, select: buildSelect(dataSourceId) };

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
    case "activityLog": {
      // Custom widgets render for whoever views the page they're placed
      // on — HR-sensitive rows are excluded unconditionally rather than
      // per-viewer, since the executor has no viewer context here.
      const activityArgs = {
        ...args,
        where: { AND: [filteredWhere, { entityType: { notIn: HR_SENSITIVE_ENTITY_TYPES } }] },
      };
      return db.activityLog.findMany(activityArgs as Parameters<typeof db.activityLog.findMany>[0]) as unknown as Record<string, unknown>[];
    }
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
    case "activityLog":
      // Same HR-sensitivity exclusion as fetchModel — counts must not
      // reveal what the row fetch hides.
      return db.activityLog.count({
        where: { AND: [w, { entityType: { notIn: HR_SENSITIVE_ENTITY_TYPES } }] },
      });
    default: return 0;
  }
}

export async function executeDataSourceQuery(config: QueryConfig): Promise<QueryResult> {
  const ds = getDataSource(config.dataSourceId);
  if (!ds) return { rows: [] };

  const allowedFields = scalarFieldKeys(config.dataSourceId);
  const where = buildWhere(config.dataSourceId, config.filters);
  const take = Math.min(config.limit || 20, MAX_LIMIT);
  const orderBy = buildOrderBy(config.dataSourceId, config.sort);

  // Aggregation mode
  if (config.aggregation) {
    const { type, field, groupByField } = config.aggregation;

    if (type === "count") {
      const count = await countModel(config.dataSourceId, where);
      return { rows: [], aggregate: count };
    }

    if (type === "countByField" && groupByField && allowedFields.has(groupByField)) {
      // Get all rows and count in JS (Prisma groupBy is complex across models)
      const rows = await queryModel(config.dataSourceId, where, orderBy, MAX_LIMIT);
      const counts: Record<string, number> = {};
      for (const row of rows) {
        const val = String(row[groupByField] ?? "Unknown");
        counts[val] = (counts[val] || 0) + 1;
      }
      return { rows: [], aggregate: counts };
    }

    if ((type === "sum" || type === "avg" || type === "min" || type === "max") && field && allowedFields.has(field)) {
      const rows = await queryModel(config.dataSourceId, where, orderBy, MAX_LIMIT);
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
  const rows = await queryModel(config.dataSourceId, where, orderBy, take);
  return { rows: rows.map((r) => flattenRow(r, config.dataSourceId)) };
}
