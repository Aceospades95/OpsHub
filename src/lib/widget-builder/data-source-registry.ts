import type { DataSourceDefinition } from "./widget-config-types";

export const DATA_SOURCES: Record<string, DataSourceDefinition> = {
  client: {
    id: "client",
    label: "Clients",
    fields: [
      { key: "name", label: "Name", type: "string" },
      { key: "status", label: "Status", type: "enum", enumValues: ["ACTIVE", "INACTIVE", "PROSPECT", "ARCHIVED"] },
      { key: "industry", label: "Industry", type: "string" },
      { key: "website", label: "Website", type: "string" },
      { key: "createdAt", label: "Created", type: "date" },
      { key: "updatedAt", label: "Updated", type: "date" },
      { key: "accountManager", label: "Account Manager", type: "string", relation: { model: "user", displayField: "name" } },
    ],
    defaultSort: { field: "name", direction: "asc" },
    aggregations: ["count", "countByField"],
  },

  project: {
    id: "project",
    label: "Projects",
    fields: [
      { key: "name", label: "Name", type: "string" },
      { key: "status", label: "Status", type: "enum", enumValues: ["PLANNING", "ACTIVE", "ON_HOLD", "COMPLETED", "ARCHIVED"] },
      { key: "startDate", label: "Start Date", type: "date" },
      { key: "endDate", label: "End Date", type: "date" },
      { key: "client", label: "Client", type: "string", relation: { model: "client", displayField: "name" } },
      { key: "createdAt", label: "Created", type: "date" },
      { key: "updatedAt", label: "Updated", type: "date" },
    ],
    defaultSort: { field: "updatedAt", direction: "desc" },
    aggregations: ["count", "countByField"],
  },

  task: {
    id: "task",
    label: "Tasks",
    fields: [
      { key: "title", label: "Title", type: "string" },
      { key: "status", label: "Status", type: "enum", enumValues: ["TODO", "IN_PROGRESS", "DONE", "CANCELLED"] },
      { key: "priority", label: "Priority", type: "enum", enumValues: ["HIGH", "MEDIUM", "LOW"] },
      { key: "dueDate", label: "Due Date", type: "date" },
      { key: "completedAt", label: "Completed", type: "date" },
      { key: "assignee", label: "Assignee", type: "string", relation: { model: "user", displayField: "name" } },
      { key: "project", label: "Project", type: "string", relation: { model: "project", displayField: "name" } },
      { key: "client", label: "Client", type: "string", relation: { model: "client", displayField: "name" } },
      { key: "createdAt", label: "Created", type: "date" },
    ],
    defaultSort: { field: "createdAt", direction: "desc" },
    aggregations: ["count", "countByField"],
  },

  contract: {
    id: "contract",
    label: "Contracts",
    fields: [
      { key: "title", label: "Title", type: "string" },
      { key: "status", label: "Status", type: "enum", enumValues: ["DRAFT", "PENDING", "ACTIVE", "EXPIRING_SOON", "EXPIRED", "TERMINATED", "RENEWED"] },
      { key: "contractType", label: "Type", type: "enum", enumValues: ["MSA", "SOW", "NDA", "SLA", "AMENDMENT", "ADDENDUM", "OTHER"] },
      { key: "value", label: "Value", type: "number" },
      { key: "startDate", label: "Start Date", type: "date" },
      { key: "endDate", label: "End Date", type: "date" },
      { key: "renewalDate", label: "Renewal Date", type: "date" },
      { key: "client", label: "Client", type: "string", relation: { model: "client", displayField: "name" } },
      { key: "createdAt", label: "Created", type: "date" },
    ],
    defaultSort: { field: "updatedAt", direction: "desc" },
    aggregations: ["count", "sum", "avg", "countByField"],
  },

  milestone: {
    id: "milestone",
    label: "Milestones",
    fields: [
      { key: "title", label: "Title", type: "string" },
      { key: "dueDate", label: "Due Date", type: "date" },
      { key: "completed", label: "Completed", type: "boolean" },
      { key: "project", label: "Project", type: "string", relation: { model: "project", displayField: "name" } },
      { key: "createdAt", label: "Created", type: "date" },
    ],
    defaultSort: { field: "dueDate", direction: "asc" },
    aggregations: ["count", "countByField"],
  },

  user: {
    id: "user",
    label: "Users",
    fields: [
      { key: "name", label: "Name", type: "string" },
      { key: "email", label: "Email", type: "string" },
      { key: "role", label: "Role", type: "enum", enumValues: ["ADMIN", "MANAGER", "DEVELOPER", "CONTRIBUTOR", "VIEWER"] },
      { key: "department", label: "Department", type: "string" },
      { key: "jobTitle", label: "Job Title", type: "string" },
      { key: "location", label: "Location", type: "string" },
      { key: "isActive", label: "Active", type: "boolean" },
      { key: "createdAt", label: "Created", type: "date" },
    ],
    defaultSort: { field: "name", direction: "asc" },
    aggregations: ["count", "countByField"],
  },

  document: {
    id: "document",
    label: "Documents",
    fields: [
      { key: "title", label: "Title", type: "string" },
      { key: "type", label: "Type", type: "enum", enumValues: ["SOP", "POLICY", "TECHNICAL", "MEETING_NOTES", "PROPOSAL", "REPORT", "OTHER"] },
      { key: "published", label: "Published", type: "boolean" },
      { key: "version", label: "Version", type: "number" },
      { key: "project", label: "Project", type: "string", relation: { model: "project", displayField: "name" } },
      { key: "createdAt", label: "Created", type: "date" },
    ],
    defaultSort: { field: "updatedAt", direction: "desc" },
    aggregations: ["count", "countByField"],
  },

  supplier: {
    id: "supplier",
    label: "Suppliers",
    fields: [
      { key: "name", label: "Name", type: "string" },
      { key: "category", label: "Category", type: "string" },
      { key: "status", label: "Status", type: "enum", enumValues: ["ACTIVE", "INACTIVE", "PROSPECT", "ARCHIVED"] },
      { key: "isPreferred", label: "Preferred", type: "boolean" },
      { key: "createdAt", label: "Created", type: "date" },
    ],
    defaultSort: { field: "name", direction: "asc" },
    aggregations: ["count", "countByField"],
  },

  certification: {
    id: "certification",
    label: "Certifications",
    fields: [
      { key: "name", label: "Name", type: "string" },
      { key: "status", label: "Status", type: "enum", enumValues: ["ACTIVE", "EXPIRING_SOON", "EXPIRED", "PENDING", "SUSPENDED", "REVOKED"] },
      { key: "type", label: "Type", type: "enum", enumValues: ["INDUSTRY", "COMPLIANCE", "SAFETY", "PROFESSIONAL", "QUALITY", "SECURITY", "ENVIRONMENTAL", "VENDOR", "OTHER"] },
      { key: "issuingBody", label: "Issuing Body", type: "string" },
      { key: "issuedDate", label: "Issued Date", type: "date" },
      { key: "expirationDate", label: "Expiration Date", type: "date" },
      { key: "renewalDate", label: "Renewal Date", type: "date" },
      { key: "renewalCost", label: "Renewal Cost", type: "number" },
      { key: "autoRenew", label: "Auto-Renew", type: "boolean" },
      { key: "client", label: "Client", type: "string", relation: { model: "client", displayField: "name" } },
      { key: "assignee", label: "Assignee", type: "string", relation: { model: "user", displayField: "name" } },
      { key: "createdAt", label: "Created", type: "date" },
    ],
    defaultSort: { field: "expirationDate", direction: "asc" },
    aggregations: ["count", "sum", "countByField"],
  },

  activityLog: {
    id: "activityLog",
    label: "Activity Logs",
    fields: [
      { key: "action", label: "Action", type: "string" },
      { key: "entityType", label: "Entity Type", type: "string" },
      { key: "details", label: "Details", type: "string" },
      { key: "user", label: "User", type: "string", relation: { model: "user", displayField: "name" } },
      { key: "createdAt", label: "Date", type: "date" },
    ],
    defaultSort: { field: "createdAt", direction: "desc" },
    aggregations: ["count", "countByField"],
  },
};

export function getDataSource(id: string): DataSourceDefinition | undefined {
  return DATA_SOURCES[id];
}

export function getAllDataSources(): DataSourceDefinition[] {
  return Object.values(DATA_SOURCES);
}
