// ─── Universal Widget Type Registry ─────────────────────

export type WidgetType =
  | "stat"
  | "task-list"
  | "activity-feed"
  | "alert-banner"
  | "embed"
  | "markdown"
  | "data-list"
  | "custom";

export interface WidgetConfig {
  id: string;
  type: WidgetType;
  title?: string;
  config: Record<string, unknown>;
  customWidgetId?: string; // references CustomWidget.id for type="custom"
}

export interface GridLayoutItem {
  i: string;
  x: number;
  y: number;
  w: number;
  h: number;
  minW?: number;
  minH?: number;
}

export interface PageWidgetLayout {
  widgets: WidgetConfig[];
  layout: GridLayoutItem[];
}

// ─── Stat Widget ────────────────────────────────────────

export interface StatConfig {
  model: string;
  filter?: Record<string, unknown>;
  label: string;
  href: string;
  icon: string;
  subLabel?: string;
}

// ─── Embed Widget ───────────────────────────────────────

export interface EmbedConfig {
  url: string;
  title?: string;
  height?: string;
}

// ─── Markdown Widget ────────────────────────────────────

export interface MarkdownConfig {
  content: string;
  title?: string;
}

// ─── Data List Widget ───────────────────────────────────

export interface DataListConfig {
  model: string;
  filter?: Record<string, unknown>;
  fields: string[]; // which fields to display
  limit: number;
  title: string;
  href?: string;
}

// ─── Task List Widget ───────────────────────────────────

export interface TaskListWidgetConfig {
  scope: "mine" | "all";
  limit: number;
}

// ─── Widget Type Metadata ───────────────────────────────

export const WIDGET_TYPE_INFO: Record<WidgetType, { label: string; description: string; defaultSize: { w: number; h: number; minW: number; minH: number } }> = {
  stat: { label: "Stat Counter", description: "Shows a count from any data source", defaultSize: { w: 3, h: 2, minW: 2, minH: 2 } },
  "task-list": { label: "Task List", description: "Shows tasks with checkboxes", defaultSize: { w: 6, h: 6, minW: 3, minH: 3 } },
  "activity-feed": { label: "Activity Feed", description: "Recent activity log", defaultSize: { w: 6, h: 6, minW: 3, minH: 3 } },
  "alert-banner": { label: "Alert Banner", description: "Contract expiry warnings", defaultSize: { w: 12, h: 1, minW: 4, minH: 1 } },
  embed: { label: "Embed", description: "Embed an iframe or external content", defaultSize: { w: 6, h: 6, minW: 3, minH: 3 } },
  markdown: { label: "Text Block", description: "Rich text content", defaultSize: { w: 6, h: 4, minW: 2, minH: 2 } },
  "data-list": { label: "Data List", description: "List records from any module", defaultSize: { w: 6, h: 5, minW: 3, minH: 3 } },
  custom: { label: "Custom Widget", description: "A saved reusable widget", defaultSize: { w: 3, h: 3, minW: 2, minH: 2 } },
};

// ─── Queryable Models ───────────────────────────────────

export const QUERYABLE_MODELS = [
  { value: "client", label: "Clients" },
  { value: "project", label: "Projects" },
  { value: "contract", label: "Contracts" },
  { value: "task", label: "Tasks" },
  { value: "supplier", label: "Suppliers" },
  { value: "user", label: "Team Members" },
  { value: "tool", label: "Tools" },
  { value: "intranetResource", label: "Intranet Resources" },
] as const;

export const MODEL_FILTERS: Record<string, { label: string; value: string; where: Record<string, unknown> }[]> = {
  client: [
    { label: "All", value: "all", where: {} },
    { label: "Active", value: "active", where: { status: "ACTIVE" } },
    { label: "Prospects", value: "prospect", where: { status: "PROSPECT" } },
    { label: "Inactive", value: "inactive", where: { status: "INACTIVE" } },
  ],
  project: [
    { label: "All", value: "all", where: {} },
    { label: "Active", value: "active", where: { status: "ACTIVE" } },
    { label: "Planning", value: "planning", where: { status: "PLANNING" } },
    { label: "Completed", value: "completed", where: { status: "COMPLETED" } },
  ],
  contract: [
    { label: "All", value: "all", where: {} },
    { label: "Active", value: "active", where: { status: "ACTIVE" } },
    { label: "Expiring", value: "expiring", where: { status: { in: ["EXPIRING_SOON", "EXPIRED"] } } },
  ],
  task: [
    { label: "All", value: "all", where: {} },
    { label: "Open", value: "open", where: { status: { in: ["TODO", "IN_PROGRESS"] } } },
    { label: "Completed", value: "done", where: { status: "DONE" } },
  ],
  supplier: [
    { label: "All", value: "all", where: {} },
    { label: "Active", value: "active", where: { status: "ACTIVE" } },
    { label: "Preferred", value: "preferred", where: { isPreferred: true } },
  ],
  user: [{ label: "All Active", value: "all", where: { isActive: true } }],
  tool: [
    { label: "All", value: "all", where: {} },
    { label: "Global", value: "global", where: { isGlobal: true } },
  ],
  intranetResource: [
    { label: "All", value: "all", where: {} },
    { label: "Published", value: "published", where: { published: true } },
  ],
};

export const MODEL_HREF_MAP: Record<string, string> = {
  client: "/clients",
  project: "/projects",
  contract: "/contracts",
  task: "/tasks",
  supplier: "/suppliers",
  user: "/admin/users",
  tool: "/tools",
  intranetResource: "/intranet",
};

export const AVAILABLE_ICONS = [
  "Building2", "FolderKanban", "FileText", "CheckSquare",
  "Truck", "Users", "Wrench", "Globe", "AlertTriangle",
  "TrendingUp", "DollarSign", "Clock", "Star", "Target",
  "BarChart3", "PieChart", "Activity", "Shield", "Zap",
] as const;

// ─── System Widget Definitions per Page Type ────────────

export interface SystemWidgetDef {
  id: string;
  title: string;
  defaultSize: { w: number; h: number; minW: number; minH: number };
}

// Pages and their default system widgets
export const PAGE_SYSTEM_WIDGETS: Record<string, SystemWidgetDef[]> = {
  dashboard: [
    { id: "stat-clients", title: "Total Clients", defaultSize: { w: 3, h: 2, minW: 2, minH: 2 } },
    { id: "stat-projects", title: "Projects", defaultSize: { w: 3, h: 2, minW: 2, minH: 2 } },
    { id: "stat-contracts", title: "Active Contracts", defaultSize: { w: 3, h: 2, minW: 2, minH: 2 } },
    { id: "stat-tasks", title: "Open Tasks", defaultSize: { w: 3, h: 2, minW: 2, minH: 2 } },
    { id: "alerts", title: "Alerts", defaultSize: { w: 12, h: 1, minW: 4, minH: 1 } },
    { id: "my-tasks", title: "My Tasks", defaultSize: { w: 6, h: 6, minW: 3, minH: 3 } },
    { id: "activity", title: "Activity Feed", defaultSize: { w: 6, h: 6, minW: 3, minH: 3 } },
  ],
  "project-detail": [
    { id: "sub-projects", title: "Sub-Projects", defaultSize: { w: 8, h: 5, minW: 4, minH: 3 } },
    { id: "milestones", title: "Milestones", defaultSize: { w: 8, h: 5, minW: 4, minH: 3 } },
    { id: "tasks", title: "Tasks", defaultSize: { w: 4, h: 5, minW: 3, minH: 3 } },
    { id: "documents", title: "Documents", defaultSize: { w: 8, h: 4, minW: 4, minH: 3 } },
    { id: "contracts", title: "Contracts", defaultSize: { w: 8, h: 4, minW: 4, minH: 3 } },
    { id: "comments", title: "Comments", defaultSize: { w: 8, h: 5, minW: 4, minH: 3 } },
    { id: "team", title: "Team", defaultSize: { w: 4, h: 5, minW: 3, minH: 3 } },
    { id: "tools", title: "Tools", defaultSize: { w: 4, h: 4, minW: 3, minH: 3 } },
    { id: "attachments", title: "Attachments", defaultSize: { w: 4, h: 4, minW: 3, minH: 3 } },
  ],
  "client-detail": [
    { id: "client-info", title: "Client Info", defaultSize: { w: 8, h: 4, minW: 4, minH: 3 } },
    { id: "projects", title: "Projects", defaultSize: { w: 8, h: 5, minW: 4, minH: 3 } },
    { id: "contracts", title: "Contracts", defaultSize: { w: 8, h: 5, minW: 4, minH: 3 } },
    { id: "comments", title: "Comments", defaultSize: { w: 8, h: 5, minW: 4, minH: 3 } },
    { id: "contacts", title: "Contacts", defaultSize: { w: 4, h: 5, minW: 3, minH: 3 } },
    { id: "tasks", title: "Tasks", defaultSize: { w: 4, h: 5, minW: 3, minH: 3 } },
  ],
  "contract-detail": [
    { id: "details", title: "Contract Details", defaultSize: { w: 8, h: 5, minW: 4, minH: 3 } },
    { id: "child-contracts", title: "Child Contracts", defaultSize: { w: 8, h: 4, minW: 4, minH: 3 } },
    { id: "terms", title: "Contract Terms", defaultSize: { w: 8, h: 5, minW: 4, minH: 3 } },
    { id: "comments", title: "Comments", defaultSize: { w: 8, h: 5, minW: 4, minH: 3 } },
    { id: "attachments", title: "Attachments", defaultSize: { w: 4, h: 5, minW: 3, minH: 3 } },
  ],
};

// Generate default layout from system widgets
export function getDefaultPageLayout(pageType: string): PageWidgetLayout {
  const defs = PAGE_SYSTEM_WIDGETS[pageType] || [];
  let y = 0;
  const widgets: WidgetConfig[] = [];
  const layout: GridLayoutItem[] = [];

  for (const def of defs) {
    widgets.push({ id: def.id, type: "custom", title: def.title, config: {} });
    layout.push({
      i: def.id,
      x: 0,
      y,
      w: def.defaultSize.w,
      h: def.defaultSize.h,
      minW: def.defaultSize.minW,
      minH: def.defaultSize.minH,
    });
    y += def.defaultSize.h;
  }

  return { widgets, layout };
}
