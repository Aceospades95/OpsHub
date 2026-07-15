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
    orderBy: Record<string, "asc" | "desc" | Record<string, "asc" | "desc">> | undefined;
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
    { key: "authProvider", label: "Auth provider", type: "string" },
    {
      key: "manager.name",
      label: "Manager",
      type: "string",
      requiresRelation: "manager",
    },
    {
      key: "manager.email",
      label: "Manager email",
      type: "string",
      requiresRelation: "manager",
    },
    { key: "isActive", label: "Active", type: "boolean", format: fmtBoolean },
    { key: "hasLoginAccess", label: "Has login", type: "boolean", format: fmtBoolean },
    { key: "createdAt", label: "Created", type: "date", format: fmtDate },
    { key: "updatedAt", label: "Updated", type: "date", format: fmtDate },
    { key: "terminationDate", label: "Termination date", type: "date", format: fmtDate },
  ],
  filters: [
    { key: "isActive", label: "Active", type: "boolean", operators: ["equals"] },
    { key: "hasLoginAccess", label: "Has login", type: "boolean", operators: ["equals"] },
    { key: "role", label: "System role", type: "enum", operators: ["equals", "in"], enumValues: ["ADMIN", "MANAGER", "DEVELOPER", "CONTRIBUTOR", "VIEWER", "GUEST"] },
    { key: "department", label: "Department", type: "string", operators: ["equals", "contains", "isNull", "isNotNull"] },
    { key: "location", label: "Location", type: "string", operators: ["equals", "contains", "isNull", "isNotNull"] },
    { key: "jobTitle", label: "Job title", type: "string", operators: ["equals", "contains", "isNull", "isNotNull"] },
    { key: "name", label: "Name", type: "string", operators: ["equals", "contains"] },
    { key: "email", label: "Email", type: "string", operators: ["equals", "contains"] },
    { key: "managerId", label: "Manager set", type: "boolean", operators: ["isNull", "isNotNull"] },
    { key: "manager.name", label: "Manager name", type: "string", operators: ["equals", "contains"], relation: "manager" },
    { key: "createdAt", label: "Created", type: "date", operators: ["gte", "lte"] },
    { key: "terminationDate", label: "Termination date", type: "date", operators: ["gte", "lte", "isNull", "isNotNull"] },
  ],
  async fetch({ where, orderBy, take, includes }) {
    const include: Record<string, unknown> = {};
    if (includes.has("manager")) {
      include.manager = { select: { id: true, name: true, email: true } };
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
    {
      key: "client.industry",
      label: "Client industry",
      type: "string",
      requiresRelation: "client",
    },
    {
      key: "client.status",
      label: "Client status",
      type: "string",
      requiresRelation: "client",
    },
    {
      key: "serviceOffering.name",
      label: "Service offering",
      type: "string",
      requiresRelation: "serviceOffering",
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
    { key: "name", label: "Name", type: "string", operators: ["equals", "contains"] },
    {
      key: "client.name",
      label: "Client name",
      type: "string",
      operators: ["equals", "contains"],
      relation: "client",
    },
    {
      key: "client.status",
      label: "Client status",
      type: "enum",
      operators: ["equals", "in"],
      enumValues: ["ACTIVE", "INACTIVE", "PROSPECT", "ARCHIVED"],
      relation: "client",
    },
    { key: "startDate", label: "Start", type: "date", operators: ["gte", "lte", "isNull", "isNotNull"] },
    { key: "endDate", label: "End", type: "date", operators: ["gte", "lte", "isNull", "isNotNull"] },
    { key: "createdAt", label: "Created", type: "date", operators: ["gte", "lte"] },
    { key: "updatedAt", label: "Updated", type: "date", operators: ["gte", "lte"] },
  ],
  async fetch({ where, orderBy, take, includes }) {
    const include: Record<string, unknown> = {};
    if (includes.has("client")) {
      include.client = { select: { id: true, name: true, industry: true, status: true } };
    }
    if (includes.has("serviceOffering")) {
      include.serviceOffering = { select: { id: true, name: true } };
    }
    const rows = await db.project.findMany({
      where: { ...where, deletedAt: null },
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
    { key: "description", label: "Description", type: "string" },
    { key: "summary", label: "Summary", type: "string" },
    {
      key: "accountManager.name",
      label: "Account manager",
      type: "string",
      requiresRelation: "accountManager",
    },
    {
      key: "accountManager.email",
      label: "Account manager email",
      type: "string",
      requiresRelation: "accountManager",
    },
    { key: "createdAt", label: "Created", type: "date", format: fmtDate },
    { key: "updatedAt", label: "Updated", type: "date", format: fmtDate },
  ],
  filters: [
    {
      key: "status",
      label: "Status",
      type: "enum",
      operators: ["equals", "in"],
      enumValues: ["ACTIVE", "INACTIVE", "PROSPECT", "ARCHIVED"],
    },
    { key: "name", label: "Name", type: "string", operators: ["equals", "contains"] },
    { key: "industry", label: "Industry", type: "string", operators: ["equals", "contains", "isNull", "isNotNull"] },
    { key: "accountManagerId", label: "Account manager set", type: "boolean", operators: ["isNull", "isNotNull"] },
    {
      key: "accountManager.name",
      label: "Account manager name",
      type: "string",
      operators: ["equals", "contains"],
      relation: "accountManager",
    },
    { key: "createdAt", label: "Created", type: "date", operators: ["gte", "lte"] },
  ],
  async fetch({ where, orderBy, take, includes }) {
    const include: Record<string, unknown> = {};
    if (includes.has("accountManager")) {
      include.accountManager = { select: { id: true, name: true, email: true } };
    }
    const rows = await db.client.findMany({
      where: { ...where, deletedAt: null },
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
    { key: "status", label: "Status", type: "enum" },
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
    {
      key: "createdBy.name",
      label: "Created by",
      type: "string",
      requiresRelation: "createdBy",
    },
    {
      key: "assignedTo.name",
      label: "Assigned to",
      type: "string",
      requiresRelation: "assignedTo",
    },
    { key: "currency", label: "Currency", type: "string" },
    { key: "subtotal", label: "Subtotal", type: "number", format: fmtCurrency },
    { key: "total", label: "Total", type: "number", format: fmtCurrency },
    { key: "taxRate", label: "Tax rate %", type: "number" },
    { key: "validUntil", label: "Valid until", type: "date", format: fmtDate },
    { key: "sentAt", label: "Sent", type: "date", format: fmtDate },
    { key: "acceptedAt", label: "Accepted", type: "date", format: fmtDate },
    { key: "rejectedAt", label: "Rejected", type: "date", format: fmtDate },
    { key: "createdAt", label: "Created", type: "date", format: fmtDate },
    { key: "updatedAt", label: "Updated", type: "date", format: fmtDate },
  ],
  filters: [
    {
      key: "status",
      label: "Status",
      type: "enum",
      operators: ["equals", "in"],
      enumValues: [
        "DRAFT",
        "SENT",
        "VIEWED",
        "ACCEPTED",
        "REJECTED",
        "EXPIRED",
        "REVISED",
      ],
    },
    {
      key: "client.name",
      label: "Client name",
      type: "string",
      operators: ["equals", "contains"],
      relation: "client",
    },
    {
      key: "project.name",
      label: "Project name",
      type: "string",
      operators: ["equals", "contains"],
      relation: "project",
    },
    { key: "title", label: "Title", type: "string", operators: ["equals", "contains"] },
    { key: "quoteNumber", label: "Quote number", type: "string", operators: ["equals", "contains"] },
    { key: "total", label: "Total", type: "number", operators: ["gte", "lte"] },
    { key: "subtotal", label: "Subtotal", type: "number", operators: ["gte", "lte"] },
    { key: "validUntil", label: "Valid until", type: "date", operators: ["gte", "lte", "isNull", "isNotNull"] },
    { key: "sentAt", label: "Sent", type: "date", operators: ["gte", "lte", "isNull", "isNotNull"] },
    { key: "acceptedAt", label: "Accepted", type: "date", operators: ["gte", "lte", "isNull", "isNotNull"] },
    { key: "createdAt", label: "Created", type: "date", operators: ["gte", "lte"] },
    { key: "assignedToId", label: "Assignee set", type: "boolean", operators: ["isNull", "isNotNull"] },
  ],
  async fetch({ where, orderBy, take, includes }) {
    const include: Record<string, unknown> = {};
    if (includes.has("client")) {
      include.client = { select: { id: true, name: true } };
    }
    if (includes.has("project")) {
      include.project = { select: { id: true, name: true } };
    }
    if (includes.has("createdBy")) {
      include.createdBy = { select: { id: true, name: true } };
    }
    if (includes.has("assignedTo")) {
      include.assignedTo = { select: { id: true, name: true } };
    }
    const rows = await db.quote.findMany({
      where: { ...where, deletedAt: null },
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
    { key: "completedAt", label: "Completed", type: "date", format: fmtDate },
    {
      key: "assignee.name",
      label: "Assignee",
      type: "string",
      requiresRelation: "assignee",
    },
    {
      key: "createdBy.name",
      label: "Created by",
      type: "string",
      requiresRelation: "createdBy",
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
    { key: "sourceType", label: "Source type", type: "string" },
    { key: "createdAt", label: "Created", type: "date", format: fmtDate },
    { key: "updatedAt", label: "Updated", type: "date", format: fmtDate },
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
    { key: "title", label: "Title", type: "string", operators: ["equals", "contains"] },
    { key: "dueDate", label: "Due date", type: "date", operators: ["gte", "lte", "isNull", "isNotNull"] },
    { key: "completedAt", label: "Completed", type: "date", operators: ["gte", "lte", "isNull", "isNotNull"] },
    { key: "assigneeId", label: "Has assignee", type: "boolean", operators: ["isNull", "isNotNull"] },
    { key: "projectId", label: "Has project", type: "boolean", operators: ["isNull", "isNotNull"] },
    { key: "clientId", label: "Has client", type: "boolean", operators: ["isNull", "isNotNull"] },
    {
      key: "assignee.name",
      label: "Assignee name",
      type: "string",
      operators: ["equals", "contains"],
      relation: "assignee",
    },
    {
      key: "project.name",
      label: "Project name",
      type: "string",
      operators: ["equals", "contains"],
      relation: "project",
    },
    {
      key: "client.name",
      label: "Client name",
      type: "string",
      operators: ["equals", "contains"],
      relation: "client",
    },
    { key: "createdAt", label: "Created", type: "date", operators: ["gte", "lte"] },
  ],
  async fetch({ where, orderBy, take, includes }) {
    const include: Record<string, unknown> = {};
    if (includes.has("assignee")) {
      include.assignee = { select: { id: true, name: true } };
    }
    if (includes.has("createdBy")) {
      include.createdBy = { select: { id: true, name: true } };
    }
    if (includes.has("project")) {
      include.project = { select: { id: true, name: true } };
    }
    if (includes.has("client")) {
      include.client = { select: { id: true, name: true } };
    }
    const rows = await db.task.findMany({
      where: { ...where, deletedAt: null },
      orderBy,
      take,
      include: Object.keys(include).length > 0 ? include : undefined,
    });
    return rows as Record<string, unknown>[];
  },
};

// ─── Contract entity ────────────────────────────────────────────────────

const CONTRACT: EntityDef = {
  label: "Contracts",
  description: "Master agreements and statements of work",
  defaultColumns: ["title", "contractNumber", "client.name", "status", "endDate"],
  defaultSort: "-endDate",
  defaultLimit: 500,
  columns: [
    { key: "title", label: "Title", type: "string" },
    { key: "contractNumber", label: "Number", type: "string" },
    { key: "status", label: "Status", type: "enum" },
    { key: "contractType", label: "Type", type: "enum" },
    { key: "value", label: "Value", type: "number", format: fmtCurrency },
    { key: "currency", label: "Currency", type: "string" },
    { key: "startDate", label: "Start", type: "date", format: fmtDate },
    { key: "endDate", label: "End", type: "date", format: fmtDate },
    { key: "renewalDate", label: "Renewal", type: "date", format: fmtDate },
    { key: "noticePeriodDays", label: "Notice period (days)", type: "number" },
    { key: "autoRenew", label: "Auto renew", type: "boolean", format: fmtBoolean },
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
    { key: "createdAt", label: "Created", type: "date", format: fmtDate },
    { key: "updatedAt", label: "Updated", type: "date", format: fmtDate },
  ],
  filters: [
    {
      key: "status",
      label: "Status",
      type: "enum",
      operators: ["equals", "in"],
      enumValues: ["DRAFT", "UNDER_REVIEW", "ACTIVE", "EXPIRING_SOON", "EXPIRED", "TERMINATED", "RENEWED"],
    },
    { key: "title", label: "Title", type: "string", operators: ["equals", "contains"] },
    { key: "contractNumber", label: "Number", type: "string", operators: ["equals", "contains"] },
    { key: "value", label: "Value", type: "number", operators: ["gte", "lte"] },
    { key: "endDate", label: "End", type: "date", operators: ["gte", "lte", "isNull", "isNotNull"] },
    { key: "renewalDate", label: "Renewal", type: "date", operators: ["gte", "lte", "isNull", "isNotNull"] },
    { key: "autoRenew", label: "Auto renew", type: "boolean", operators: ["equals"] },
    {
      key: "client.name",
      label: "Client name",
      type: "string",
      operators: ["equals", "contains"],
      relation: "client",
    },
  ],
  async fetch({ where, orderBy, take, includes }) {
    const include: Record<string, unknown> = {};
    if (includes.has("client")) {
      include.client = { select: { id: true, name: true } };
    }
    if (includes.has("project")) {
      include.project = { select: { id: true, name: true } };
    }
    const rows = await db.contract.findMany({
      where: { ...where, deletedAt: null },
      orderBy,
      take,
      include: Object.keys(include).length > 0 ? include : undefined,
    });
    return rows as Record<string, unknown>[];
  },
};

// ─── Certification entity ───────────────────────────────────────────────

const CERTIFICATION: EntityDef = {
  label: "Certifications",
  description: "Tracked certifications and renewals",
  defaultColumns: ["name", "status", "client.name", "assignee.name", "expirationDate"],
  defaultSort: "expirationDate",
  defaultLimit: 500,
  columns: [
    { key: "name", label: "Name", type: "string" },
    { key: "status", label: "Status", type: "enum" },
    { key: "type", label: "Type", type: "enum" },
    { key: "engagementType", label: "Engagement", type: "enum" },
    { key: "issuingBody", label: "Issuing body", type: "string" },
    { key: "jurisdictionLevel", label: "Jurisdiction level", type: "enum" },
    { key: "jurisdictionName", label: "Jurisdiction", type: "string" },
    { key: "issuedDate", label: "Issued", type: "date", format: fmtDate },
    { key: "submittedDate", label: "Submitted", type: "date", format: fmtDate },
    { key: "expirationDate", label: "Expires", type: "date", format: fmtDate },
    { key: "renewalDate", label: "Renewal", type: "date", format: fmtDate },
    { key: "renewalCost", label: "Renewal cost", type: "number", format: fmtCurrency },
    { key: "autoRenew", label: "Auto renew", type: "boolean", format: fmtBoolean },
    {
      key: "client.name",
      label: "Client",
      type: "string",
      requiresRelation: "client",
    },
    {
      key: "assignee.name",
      label: "Assignee",
      type: "string",
      requiresRelation: "assignee",
    },
    {
      key: "pointOfContact.name",
      label: "Point of contact",
      type: "string",
      requiresRelation: "pointOfContact",
    },
    { key: "createdAt", label: "Created", type: "date", format: fmtDate },
  ],
  filters: [
    {
      key: "status",
      label: "Status",
      type: "enum",
      operators: ["equals", "in"],
      enumValues: ["ACTIVE", "EXPIRING_SOON", "EXPIRED", "PENDING", "SUSPENDED", "REVOKED"],
    },
    {
      key: "engagementType",
      label: "Engagement",
      type: "enum",
      operators: ["equals", "in"],
      enumValues: ["SUBSCRIPTION", "CERTIFICATION"],
    },
    { key: "name", label: "Name", type: "string", operators: ["equals", "contains"] },
    { key: "issuingBody", label: "Issuing body", type: "string", operators: ["equals", "contains"] },
    { key: "expirationDate", label: "Expires", type: "date", operators: ["gte", "lte", "isNull", "isNotNull"] },
    { key: "renewalDate", label: "Renewal", type: "date", operators: ["gte", "lte", "isNull", "isNotNull"] },
    { key: "autoRenew", label: "Auto renew", type: "boolean", operators: ["equals"] },
    { key: "assigneeId", label: "Has assignee", type: "boolean", operators: ["isNull", "isNotNull"] },
    {
      key: "client.name",
      label: "Client name",
      type: "string",
      operators: ["equals", "contains"],
      relation: "client",
    },
  ],
  async fetch({ where, orderBy, take, includes }) {
    const include: Record<string, unknown> = {};
    if (includes.has("client")) {
      include.client = { select: { id: true, name: true } };
    }
    if (includes.has("assignee")) {
      include.assignee = { select: { id: true, name: true } };
    }
    if (includes.has("pointOfContact")) {
      include.pointOfContact = { select: { id: true, name: true } };
    }
    const rows = await db.certification.findMany({
      where: { ...where, deletedAt: null },
      orderBy,
      take,
      include: Object.keys(include).length > 0 ? include : undefined,
    });
    return rows as Record<string, unknown>[];
  },
};

// ─── Assignment entity ──────────────────────────────────────────────────

const ASSIGNMENT: EntityDef = {
  label: "Assignments",
  description: "FTE allocations of employees to projects, clients, or roles",
  defaultColumns: [
    "employee.name",
    "project.name",
    "client.name",
    "allocationFte",
    "status",
  ],
  defaultSort: "-startDate",
  defaultLimit: 500,
  columns: [
    {
      key: "employee.name",
      label: "Employee",
      type: "string",
      requiresRelation: "employee",
    },
    {
      key: "employee.email",
      label: "Employee email",
      type: "string",
      requiresRelation: "employee",
    },
    {
      key: "employee.jobTitle",
      label: "Employee job title",
      type: "string",
      requiresRelation: "employee",
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
    {
      key: "serviceOffering.name",
      label: "Service offering",
      type: "string",
      requiresRelation: "serviceOffering",
    },
    {
      key: "roleDefinition.name",
      label: "Role",
      type: "string",
      requiresRelation: "roleDefinition",
    },
    { key: "function", label: "Function", type: "string" },
    { key: "allocationFte", label: "FTE", type: "number" },
    { key: "status", label: "Status", type: "enum" },
    { key: "startDate", label: "Start", type: "date", format: fmtDate },
    { key: "endDate", label: "End", type: "date", format: fmtDate },
    { key: "createdAt", label: "Created", type: "date", format: fmtDate },
  ],
  filters: [
    {
      key: "status",
      label: "Status",
      type: "enum",
      operators: ["equals", "in"],
      enumValues: ["ACTIVE", "PLANNED", "COMPLETED", "ON_HOLD"],
    },
    { key: "allocationFte", label: "FTE", type: "number", operators: ["gt", "gte", "lt", "lte", "equals"] },
    { key: "function", label: "Function", type: "string", operators: ["equals", "contains", "isNull", "isNotNull"] },
    { key: "startDate", label: "Start", type: "date", operators: ["gte", "lte", "isNull", "isNotNull"] },
    { key: "endDate", label: "End", type: "date", operators: ["gte", "lte", "isNull", "isNotNull"] },
    {
      key: "employee.name",
      label: "Employee name",
      type: "string",
      operators: ["equals", "contains"],
      relation: "employee",
    },
    {
      key: "project.name",
      label: "Project name",
      type: "string",
      operators: ["equals", "contains"],
      relation: "project",
    },
    {
      key: "client.name",
      label: "Client name",
      type: "string",
      operators: ["equals", "contains"],
      relation: "client",
    },
  ],
  async fetch({ where, orderBy, take, includes }) {
    const include: Record<string, unknown> = {};
    if (includes.has("employee")) {
      include.employee = { select: { id: true, name: true, email: true, jobTitle: true } };
    }
    if (includes.has("project")) {
      include.project = { select: { id: true, name: true } };
    }
    if (includes.has("client")) {
      include.client = { select: { id: true, name: true } };
    }
    if (includes.has("serviceOffering")) {
      include.serviceOffering = { select: { id: true, name: true } };
    }
    if (includes.has("roleDefinition")) {
      include.roleDefinition = { select: { id: true, name: true } };
    }
    const rows = await db.assignment.findMany({
      where,
      orderBy,
      take,
      include: Object.keys(include).length > 0 ? include : undefined,
    });
    return rows as Record<string, unknown>[];
  },
};

// ─── Subcontractor entity ───────────────────────────────────────────────

const SUBCONTRACTOR: EntityDef = {
  label: "Subcontractors",
  description: "External project labor — 1099s, sub firms, and staffing agencies",
  defaultColumns: ["name", "type", "status", "complianceStatus", "insuranceExpiresAt", "accountManager.name"],
  defaultSort: "name",
  defaultLimit: 500,
  columns: [
    { key: "name", label: "Name", type: "string" },
    { key: "legalName", label: "Legal name", type: "string" },
    { key: "type", label: "Type", type: "enum" },
    { key: "status", label: "Status", type: "enum" },
    { key: "complianceStatus", label: "Compliance", type: "enum" },
    { key: "insuranceExpiresAt", label: "Insurance expires", type: "date", format: fmtDate },
    { key: "msaSignedAt", label: "MSA signed", type: "date", format: fmtDate },
    { key: "ndaSignedAt", label: "NDA signed", type: "date", format: fmtDate },
    { key: "w9OnFile", label: "W-9 on file", type: "boolean", format: fmtBoolean },
    { key: "isPreferred", label: "Preferred", type: "boolean", format: fmtBoolean },
    { key: "rating", label: "Rating", type: "number" },
    { key: "defaultRate", label: "Default rate", type: "number", format: fmtCurrency },
    { key: "rateUnit", label: "Rate unit", type: "string" },
    { key: "paymentTerms", label: "Payment terms", type: "string" },
    { key: "primaryContactName", label: "Primary contact", type: "string" },
    { key: "primaryContactEmail", label: "Contact email", type: "string" },
    { key: "primaryContactPhone", label: "Contact phone", type: "string" },
    { key: "website", label: "Website", type: "string" },
    {
      key: "accountManager.name",
      label: "Account manager",
      type: "string",
      requiresRelation: "accountManager",
    },
    { key: "createdAt", label: "Created", type: "date", format: fmtDate },
    { key: "updatedAt", label: "Updated", type: "date", format: fmtDate },
  ],
  filters: [
    {
      key: "status",
      label: "Status",
      type: "enum",
      operators: ["equals", "in"],
      enumValues: ["ACTIVE", "INACTIVE", "ONBOARDING", "SUSPENDED", "ARCHIVED"],
    },
    {
      key: "type",
      label: "Type",
      type: "enum",
      operators: ["equals", "in"],
      enumValues: ["INDIVIDUAL", "COMPANY", "AGENCY"],
    },
    {
      key: "complianceStatus",
      label: "Compliance",
      type: "enum",
      operators: ["equals", "in"],
      enumValues: ["COMPLIANT", "PENDING", "EXPIRED", "NON_COMPLIANT"],
    },
    { key: "name", label: "Name", type: "string", operators: ["equals", "contains"] },
    { key: "isPreferred", label: "Preferred", type: "boolean", operators: ["equals"] },
    { key: "w9OnFile", label: "W-9 on file", type: "boolean", operators: ["equals"] },
    { key: "insuranceExpiresAt", label: "Insurance expires", type: "date", operators: ["gte", "lte", "isNull", "isNotNull"] },
    { key: "msaSignedAt", label: "MSA signed", type: "date", operators: ["isNull", "isNotNull"] },
    { key: "rating", label: "Rating", type: "number", operators: ["gte", "lte"] },
    {
      key: "accountManager.name",
      label: "Account manager",
      type: "string",
      operators: ["equals", "contains"],
      relation: "accountManager",
    },
    { key: "createdAt", label: "Created", type: "date", operators: ["gte", "lte"] },
  ],
  async fetch({ where, orderBy, take, includes }) {
    const include: Record<string, unknown> = {};
    if (includes.has("accountManager")) {
      include.accountManager = { select: { id: true, name: true, email: true } };
    }
    const rows = await db.subcontractor.findMany({
      where: { ...where, deletedAt: null },
      orderBy,
      take,
      include: Object.keys(include).length > 0 ? include : undefined,
    });
    return rows as Record<string, unknown>[];
  },
};

// ─── Partnership entity ─────────────────────────────────────────────────

const PARTNERSHIP: EntityDef = {
  label: "Partnerships",
  description: "Strategic relationships with external organizations",
  defaultColumns: ["name", "type", "status", "tier", "relationshipOwner.name", "agreementExpiresAt"],
  defaultSort: "name",
  defaultLimit: 500,
  columns: [
    { key: "name", label: "Name", type: "string" },
    { key: "legalName", label: "Legal name", type: "string" },
    { key: "type", label: "Type", type: "enum" },
    { key: "status", label: "Status", type: "enum" },
    { key: "tier", label: "Tier", type: "enum" },
    { key: "industry", label: "Industry", type: "string" },
    { key: "partnerSinceDate", label: "Partner since", type: "date", format: fmtDate },
    { key: "agreementSignedAt", label: "Agreement signed", type: "date", format: fmtDate },
    { key: "agreementExpiresAt", label: "Agreement expires", type: "date", format: fmtDate },
    { key: "autoRenew", label: "Auto-renew", type: "boolean", format: fmtBoolean },
    { key: "referralFeeBps", label: "Referral fee (bps)", type: "number" },
    { key: "jointMarketing", label: "Joint marketing", type: "boolean", format: fmtBoolean },
    { key: "primaryContactName", label: "Primary contact", type: "string" },
    { key: "primaryContactEmail", label: "Contact email", type: "string" },
    {
      key: "relationshipOwner.name",
      label: "Owner",
      type: "string",
      requiresRelation: "relationshipOwner",
    },
    { key: "createdAt", label: "Created", type: "date", format: fmtDate },
    { key: "updatedAt", label: "Updated", type: "date", format: fmtDate },
  ],
  filters: [
    {
      key: "status",
      label: "Status",
      type: "enum",
      operators: ["equals", "in"],
      enumValues: ["ACTIVE", "PROSPECT", "INACTIVE", "PAUSED", "ARCHIVED"],
    },
    {
      key: "type",
      label: "Type",
      type: "enum",
      operators: ["equals", "in"],
      enumValues: ["STRATEGIC", "REFERRAL", "RESELLER", "TECHNOLOGY", "CHANNEL", "JOINT_VENTURE", "AFFILIATE", "OTHER"],
    },
    {
      key: "tier",
      label: "Tier",
      type: "enum",
      operators: ["equals", "in", "isNull", "isNotNull"],
      enumValues: ["PLATINUM", "GOLD", "SILVER", "BRONZE", "STANDARD"],
    },
    { key: "name", label: "Name", type: "string", operators: ["equals", "contains"] },
    { key: "industry", label: "Industry", type: "string", operators: ["equals", "contains", "isNull", "isNotNull"] },
    { key: "agreementExpiresAt", label: "Agreement expires", type: "date", operators: ["gte", "lte", "isNull", "isNotNull"] },
    { key: "autoRenew", label: "Auto-renew", type: "boolean", operators: ["equals"] },
    { key: "jointMarketing", label: "Joint marketing", type: "boolean", operators: ["equals"] },
    {
      key: "relationshipOwner.name",
      label: "Owner",
      type: "string",
      operators: ["equals", "contains"],
      relation: "relationshipOwner",
    },
    { key: "createdAt", label: "Created", type: "date", operators: ["gte", "lte"] },
  ],
  async fetch({ where, orderBy, take, includes }) {
    const include: Record<string, unknown> = {};
    if (includes.has("relationshipOwner")) {
      include.relationshipOwner = { select: { id: true, name: true, email: true } };
    }
    const rows = await db.partnership.findMany({
      where: { ...where, deletedAt: null },
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
  CONTRACT,
  CERTIFICATION,
  ASSIGNMENT,
  SUBCONTRACTOR,
  PARTNERSHIP,
};

export function getEntityDef(entity: CustomReportEntity): EntityDef {
  const def = ENTITY_REGISTRY[entity];
  if (!def) throw new Error(`Unknown entity ${entity}`);
  return def;
}
