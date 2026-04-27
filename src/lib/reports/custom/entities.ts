/**
 * Entity registry for the custom report builder.
 *
 * Each entry defines:
 *   - which Prisma model the report runs against
 *   - the list of selectable columns (key, label, optional formatter,
 *     optional required-relation include)
 *   - the list of filterable fields (with allowed operators)
 *   - the default columns + sort for a brand-new report
 *
 * The runtime in ./runtime.ts walks these definitions to turn a
 * CustomReport row into a Prisma query and a ReportOutput. Adding a
 * new entity is a one-file change here — UI + runtime pick it up.
 *
 * Constraints we deliberately chose:
 *   - No cross-entity joins. A report runs against a single entity;
 *     "show projects with their client name" is allowed only because
 *     "client.name" is a curated column on the PROJECT entity that
 *     pulls the related Client row in a single query.
 *   - No free aggregation. Reports are list views, not pivot tables.
 *     The existing /admin/reports system covers aggregate use cases
 *     when those need bespoke queries.
 *   - Filter values are typed at the value level only — column names
 *     and operators come from the registry so admins never compose
 *     a Prisma filter object directly.
 */

import { db } from "@/lib/db";
import type { CustomReportEntity } from "@prisma/client";
import { format } from "date-fns";

// ─── Types ──────────────────────────────────────────────────────────────

export type FilterOperator =
  | "equals"
  | "contains" // case-insensitive substring (string fields only)
  | "in"       // value is a comma-separated list
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "isNull"
  | "isNotNull";

export type FieldType = "string" | "number" | "date" | "boolean" | "enum";

export interface ColumnDef {
  /** Unique key per entity. Used in the saved CustomReport.columns
   *  array AND as the row property the renderer reads. */
  key: string;
  label: string;
  type: FieldType;
  /** Format the raw value for HTML/CSV output. Default: String(v) with
   *  null → em-dash. */
  format?: (value: unknown) => string;
  /** When set, this column requires the named relation to be included
   *  in the Prisma query. The runtime auto-includes any relations
   *  referenced by the selected columns. */
  requiresRelation?: string;
  /** For enum fields, the list of allowed values. Drives the filter
   *  picker. */
  enumValues?: string[];
}

export interface FilterDef {
  key: string;
  label: string;
  type: FieldType;
  /** Operators the UI should expose for this field. */
  operators: FilterOperator[];
  enumValues?: string[];
  /** When set, the runtime applies the operator to a relation field
   *  (e.g. `client.name contains "acme"` becomes `{ client: { name:
   *  { contains: "acme" } } }`). */
  relation?: string;
}

export interface EntityDef {
  /** Display label in the UI. */
  label: string;
  description: string;
  columns: ColumnDef[];
  filters: FilterDef[];
  /** Columns selected when a brand-new report is created. */
  defaultColumns: string[];
  /** Sort key (prefix "-" for descending) used when none is set. */
  defaultSort?: string;
  /** Max rows returned when the saved report's `limit` is null. */
  defaultLimit: number;
  /** Runs the actual query. Receives the resolved Prisma `where` +
   *  `orderBy` + `take` and returns rows ready to be mapped to the
   *  selected columns. The runtime handles column projection so each
   *  entity definition just needs to fetch with the right includes. */
  fetch: (params: {
    where: Record<string, unknown>;
    orderBy: Record<string, "asc" | "desc"> | undefined;
    take: number;
    includes: Set<string>;
  }) => Promise<Record<string, unknown>[]>;
}

// ─── Helpers ────────────────────────────────────────────────────────────

const dash = "—";
function fmtDate(v: unknown): string {
  if (!v) return dash;
  const d = v instanceof Date ? v : new Date(String(v));
  if (isNaN(d.getTime())) return dash;
  return format(d, "MMM d, yyyy");
}
function fmtCurrency(v: unknown): string {
  if (v == null) return dash;
  const n = Number(v);
  if (!Number.isFinite(n)) return dash;
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  });
}
function fmtBoolean(v: unknown): string {
  return v ? "Yes" : "No";
}

// ─── User entity ────────────────────────────────────────────────────────

const USER: EntityDef = {
  label: "Employees",
  description: "Active and inactive team members",
  defaultColumns: ["name", "email", "jobTitle", "department", "manager.name"],
  defaultSort: "name",
  defaultLimit: 500,
  columns: [
    { key: "name", label: "Name", type: "string" },
    { key: "email", label: "Email", type: "string" },
    { key: "role", label: "System role", type: "enum" },
    { key: "jobTitle", label: "Job title", type: "string" },
    { key: "department", label: "Department", type: "string" },
    { key: "location", label: "Location", type: "string" },
    { key: "phone", label: "Phone", type: "string" },
    {
      key: "manager.name",
      label: "Manager",
      type: "string",
      requiresRelation: "manager",
    },
    { key: "isActive", label: "Active", type: "boolean", format: fmtBoolean },
    { key: "hasLoginAccess", label: "Has login", type: "boolean", format: fmtBoolean },
    { key: "createdAt", label: "Created", type: "date", format: fmtDate },
    { key: "terminationDate", label: "Termination date", type: "date", format: fmtDate },
  ],
  filters: [
    { key: "isActive", label: "Active", type: "boolean", operators: ["equals"] },
    { key: "role", label: "System role", type: "enum", operators: ["equals", "in"], enumValues: ["ADMIN", "MANAGER", "DEVELOPER", "CONTRIBUTOR", "VIEWER", "GUEST"] },
    { key: "department", label: "Department", type: "string", operators: ["equals", "contains", "isNull", "isNotNull"] },
    { key: "location", label: "Location", type: "string", operators: ["equals", "contains", "isNull", "isNotNull"] },
    { key: "jobTitle", label: "Job title", type: "string", operators: ["equals", "contains", "isNull", "isNotNull"] },
    { key: "managerId", label: "Manager set", type: "boolean", operators: ["isNull", "isNotNull"] },
    { key: "createdAt", label: "Created", type: "date", operators: ["gte", "lte"] },
    { key: "terminationDate", label: "Termination date", type: "date", operators: ["gte", "lte", "isNull", "isNotNull"] },
  ],
  async fetch({ where, orderBy, take, includes }) {
    const include: Record<string, unknown> = {};
    if (includes.has("manager")) {
      include.manager = { select: { id: true, name: true } };
    }
    const rows = await db.user.findMany({
      where,
      orderBy,
      take,
      include: Object.keys(include).length > 0 ? include : undefined,
    });
    return rows as Record<string, unknown>[];
  },
};

// ─── Project entity ─────────────────────────────────────────────────────

const PROJECT: EntityDef = {
  label: "Projects",
  description: "Project portfolio with status, client, and key dates",
  defaultColumns: ["name", "status", "client.name", "startDate", "endDate"],
  defaultSort: "-updatedAt",
  defaultLimit: 500,
  columns: [
    { key: "name", label: "Name", type: "string" },
    { key: "status", label: "Status", type: "enum" },
    { key: "description", label: "Description", type: "string" },
    {
      key: "client.name",
      label: "Client",
      type: "string",
      requiresRelation: "client",
    },
    { key: "startDate", label: "Start", type: "date", format: fmtDate },
    { key: "endDate", label: "End", type: "date", format: fmtDate },
    { key: "createdAt", label: "Created", type: "date", format: fmtDate },
    { key: "updatedAt", label: "Updated", type: "date", format: fmtDate },
  ],
  filters: [
    {
      key: "status",
      label: "Status",
      type: "enum",
      operators: ["equals", "in"],
      enumValues: ["PLANNING", "ACTIVE", "ON_HOLD", "COMPLETED", "ARCHIVED"],
    },
    {
      key: "client.name",
      label: "Client name",
      type: "string",
      operators: ["equals", "contains"],
      relation: "client",
    },
    { key: "startDate", label: "Start", type: "date", operators: ["gte", "lte", "isNull", "isNotNull"] },
    { key: "endDate", label: "End", type: "date", operators: ["gte", "lte", "isNull", "isNotNull"] },
  ],
  async fetch({ where, orderBy, take, includes }) {
    const include: Record<string, unknown> = {};
    if (includes.has("client")) {
      include.client = { select: { id: true, name: true } };
    }
    const rows = await db.project.findMany({
      where,
      orderBy,
      take,
      include: Object.keys(include).length > 0 ? include : undefined,
    });
    return rows as Record<string, unknown>[];
  },
};

// ─── Client entity ──────────────────────────────────────────────────────

const CLIENT: EntityDef = {
  label: "Clients",
  description: "Client accounts and engagements",
  defaultColumns: ["name", "industry", "status", "accountManager.name"],
  defaultSort: "name",
  defaultLimit: 500,
  columns: [
    { key: "name", label: "Name", type: "string" },
    { key: "industry", label: "Industry", type: "string" },
    { key: "status", label: "Status", type: "enum" },
    { key: "website", label: "Website", type: "string" },
    {
      key: "accountManager.name",
      label: "Account manager",
      type: "string",
      requiresRelation: "accountManager",
    },
    { key: "createdAt", label: "Created", type: "date", format: fmtDate },
  ],
  filters: [
    {
      key: "status",
      label: "Status",
      type: "enum",
      operators: ["equals", "in"],
      enumValues: ["ACTIVE", "INACTIVE", "PROSPECT", "ARCHIVED"],
    },
    { key: "industry", label: "Industry", type: "string", operators: ["equals", "contains", "isNull"] },
  ],
  async fetch({ where, orderBy, take, includes }) {
    const include: Record<string, unknown> = {};
    if (includes.has("accountManager")) {
      include.accountManager = { select: { id: true, name: true } };
    }
    const rows = await db.client.findMany({
      where,
      orderBy,
      take,
      include: Object.keys(include).length > 0 ? include : undefined,
    });
    return rows as Record<string, unknown>[];
  },
};

// ─── Quote entity ───────────────────────────────────────────────────────

const QUOTE: EntityDef = {
  label: "Quotes",
  description: "Stored quotes with totals, client, and timestamps",
  defaultColumns: ["quoteNumber", "title", "client.name", "total", "updatedAt"],
  defaultSort: "-updatedAt",
  defaultLimit: 500,
  columns: [
    { key: "quoteNumber", label: "Number", type: "string" },
    { key: "title", label: "Title", type: "string" },
    {
      key: "client.name",
      label: "Client",
      type: "string",
      requiresRelation: "client",
    },
    {
      key: "project.name",
      label: "Project",
      type: "string",
      requiresRelation: "project",
    },
    { key: "subtotal", label: "Subtotal", type: "number", format: fmtCurrency },
    { key: "total", label: "Total", type: "number", format: fmtCurrency },
    { key: "validUntil", label: "Valid until", type: "date", format: fmtDate },
    { key: "createdAt", label: "Created", type: "date", format: fmtDate },
    { key: "updatedAt", label: "Updated", type: "date", format: fmtDate },
  ],
  filters: [
    {
      key: "client.name",
      label: "Client name",
      type: "string",
      operators: ["equals", "contains"],
      relation: "client",
    },
    { key: "total", label: "Total", type: "number", operators: ["gte", "lte"] },
    { key: "createdAt", label: "Created", type: "date", operators: ["gte", "lte"] },
  ],
  async fetch({ where, orderBy, take, includes }) {
    const include: Record<string, unknown> = {};
    if (includes.has("client")) {
      include.client = { select: { id: true, name: true } };
    }
    if (includes.has("project")) {
      include.project = { select: { id: true, name: true } };
    }
    const rows = await db.quote.findMany({
      where,
      orderBy,
      take,
      include: Object.keys(include).length > 0 ? include : undefined,
    });
    return rows as Record<string, unknown>[];
  },
};

// ─── Task entity ────────────────────────────────────────────────────────

const TASK: EntityDef = {
  label: "Tasks",
  description: "Action items across the workspace",
  defaultColumns: ["title", "status", "priority", "assignee.name", "dueDate"],
  defaultSort: "dueDate",
  defaultLimit: 500,
  columns: [
    { key: "title", label: "Title", type: "string" },
    { key: "description", label: "Description", type: "string" },
    { key: "status", label: "Status", type: "enum" },
    { key: "priority", label: "Priority", type: "enum" },
    { key: "dueDate", label: "Due", type: "date", format: fmtDate },
    {
      key: "assignee.name",
      label: "Assignee",
      type: "string",
      requiresRelation: "assignee",
    },
    {
      key: "project.name",
      label: "Project",
      type: "string",
      requiresRelation: "project",
    },
    {
      key: "client.name",
      label: "Client",
      type: "string",
      requiresRelation: "client",
    },
    { key: "createdAt", label: "Created", type: "date", format: fmtDate },
  ],
  filters: [
    {
      key: "status",
      label: "Status",
      type: "enum",
      operators: ["equals", "in"],
      enumValues: ["TODO", "IN_PROGRESS", "DONE", "CANCELLED"],
    },
    {
      key: "priority",
      label: "Priority",
      type: "enum",
      operators: ["equals", "in"],
      enumValues: ["HIGH", "MEDIUM", "LOW"],
    },
    { key: "dueDate", label: "Due date", type: "date", operators: ["gte", "lte", "isNull", "isNotNull"] },
    { key: "assigneeId", label: "Has assignee", type: "boolean", operators: ["isNull", "isNotNull"] },
  ],
  async fetch({ where, orderBy, take, includes }) {
    const include: Record<string, unknown> = {};
    if (includes.has("assignee")) {
      include.assignee = { select: { id: true, name: true } };
    }
    if (includes.has("project")) {
      include.project = { select: { id: true, name: true } };
    }
    if (includes.has("client")) {
      include.client = { select: { id: true, name: true } };
    }
    const rows = await db.task.findMany({
      where,
      orderBy,
      take,
      include: Object.keys(include).length > 0 ? include : undefined,
    });
    return rows as Record<string, unknown>[];
  },
};

// ─── Registry ──────────────────────────────────────────────────────────

export const ENTITY_REGISTRY: Record<CustomReportEntity, EntityDef> = {
  USER,
  PROJECT,
  CLIENT,
  QUOTE,
  TASK,
};

export function getEntityDef(entity: CustomReportEntity): EntityDef {
  const def = ENTITY_REGISTRY[entity];
  if (!def) throw new Error(`Unknown entity ${entity}`);
  return def;
}
