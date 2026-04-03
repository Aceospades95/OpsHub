// ─── Widget Type Definitions ────────────────────────────

export type WidgetType = "stat" | "task-list" | "activity-feed" | "alert-banner";

export interface StatWidgetConfig {
  model: string;     // "client" | "project" | "contract" | "task" | "supplier" | "user" | "tool" | "intranetResource"
  filter?: Record<string, unknown>; // Prisma-compatible where clause
  label: string;
  href: string;
  icon: string;
  subLabel?: string; // e.g., "2 active"
}

export interface TaskListConfig {
  scope: "mine" | "all";
  limit: number;
}

export interface DashboardWidget {
  id: string;
  type: WidgetType;
  config: StatWidgetConfig | TaskListConfig | Record<string, unknown>;
}

export interface GridItem {
  i: string;   // widget ID
  x: number;
  y: number;
  w: number;   // width in grid units (out of 12)
  h: number;   // height in grid units
  minW?: number;
  minH?: number;
}

export interface DashboardLayoutConfig {
  widgets: DashboardWidget[];
  layout: GridItem[];
}

export interface LayoutTemplate {
  id: string;
  name: string;
  pageType: string;
  config: DashboardLayoutConfig;
  createdAt: string;
}

// ─── Available Models for Stat Queries ──────────────────

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

// Common filters per model
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
    { label: "Expiring Soon", value: "expiring", where: { status: { in: ["EXPIRING_SOON", "EXPIRED"] } } },
    { label: "Draft", value: "draft", where: { status: "DRAFT" } },
  ],
  task: [
    { label: "All", value: "all", where: {} },
    { label: "Open", value: "open", where: { status: { in: ["TODO", "IN_PROGRESS"] } } },
    { label: "Overdue", value: "overdue", where: { status: { in: ["TODO", "IN_PROGRESS"] }, dueDate: { lt: new Date() } } },
    { label: "Completed", value: "done", where: { status: "DONE" } },
  ],
  supplier: [
    { label: "All", value: "all", where: {} },
    { label: "Active", value: "active", where: { status: "ACTIVE" } },
    { label: "Preferred", value: "preferred", where: { isPreferred: true } },
  ],
  user: [
    { label: "All Active", value: "all", where: { isActive: true } },
  ],
  tool: [
    { label: "All", value: "all", where: {} },
    { label: "Global", value: "global", where: { isGlobal: true } },
  ],
  intranetResource: [
    { label: "All", value: "all", where: {} },
    { label: "Published", value: "published", where: { published: true } },
  ],
};

export const AVAILABLE_ICONS = [
  "Building2", "FolderKanban", "FileText", "CheckSquare",
  "Truck", "Users", "Wrench", "Globe", "AlertTriangle",
  "TrendingUp", "DollarSign", "Clock", "Star", "Target",
  "BarChart3", "PieChart", "Activity", "Shield", "Zap",
] as const;

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

// ─── Default Dashboard Layout ───────────────────────────

export const DEFAULT_DASHBOARD: DashboardLayoutConfig = {
  widgets: [
    { id: "stat-clients", type: "stat", config: { model: "client", filter: {}, label: "Total Clients", href: "/clients", icon: "Building2" } },
    { id: "stat-projects", type: "stat", config: { model: "project", filter: {}, label: "Projects", href: "/projects", icon: "FolderKanban", subLabel: "active" } },
    { id: "stat-contracts", type: "stat", config: { model: "contract", filter: { status: "ACTIVE" }, label: "Active Contracts", href: "/contracts", icon: "FileText" } },
    { id: "stat-tasks", type: "stat", config: { model: "task", filter: { status: { in: ["TODO", "IN_PROGRESS"] } }, label: "Open Tasks", href: "/tasks", icon: "CheckSquare" } },
    { id: "alerts", type: "alert-banner", config: {} },
    { id: "my-tasks", type: "task-list", config: { scope: "mine", limit: 8 } },
    { id: "activity", type: "activity-feed", config: {} },
  ],
  layout: [
    { i: "stat-clients", x: 0, y: 0, w: 3, h: 2, minW: 2, minH: 2 },
    { i: "stat-projects", x: 3, y: 0, w: 3, h: 2, minW: 2, minH: 2 },
    { i: "stat-contracts", x: 6, y: 0, w: 3, h: 2, minW: 2, minH: 2 },
    { i: "stat-tasks", x: 9, y: 0, w: 3, h: 2, minW: 2, minH: 2 },
    { i: "alerts", x: 0, y: 2, w: 12, h: 1, minW: 4, minH: 1 },
    { i: "my-tasks", x: 0, y: 3, w: 6, h: 6, minW: 3, minH: 3 },
    { i: "activity", x: 6, y: 3, w: 6, h: 6, minW: 3, minH: 3 },
  ],
};
