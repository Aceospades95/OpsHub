export type WidgetCategory =
  | "analytics"
  | "communication"
  | "productivity"
  | "content"
  | "data"
  | "status";

export const WIDGET_CATEGORY_LABELS: Record<WidgetCategory, string> = {
  analytics: "Analytics & Metrics",
  communication: "Communication",
  productivity: "Productivity",
  content: "Content & Media",
  data: "Data & Lists",
  status: "Status & Monitoring",
};

export interface WidgetDefinition {
  id: string;
  label: string;
  description: string;
  category: WidgetCategory;
  icon: string; // lucide icon name
  defaultGrid: { w: number; h: number; minW: number; minH: number };
}

/**
 * Global widgets available on ANY page.
 * Page-specific widgets (client-info, project tasks, etc.) are still defined in PAGE_CARDS.
 */
export const GLOBAL_WIDGETS: WidgetDefinition[] = [
  // --- Analytics & Metrics ---
  {
    id: "widget-kpi-card",
    label: "KPI Card",
    description: "Display a key performance indicator with trend",
    category: "analytics",
    icon: "TrendingUp",
    defaultGrid: { w: 4, h: 6, minW: 3, minH: 4 },
  },
  {
    id: "widget-progress-tracker",
    label: "Progress Tracker",
    description: "Visual progress bars for goals or milestones",
    category: "analytics",
    icon: "BarChart3",
    defaultGrid: { w: 6, h: 7, minW: 4, minH: 4 },
  },
  {
    id: "widget-stats-summary",
    label: "Stats Summary",
    description: "Compact summary of key metrics in a row",
    category: "analytics",
    icon: "PieChart",
    defaultGrid: { w: 12, h: 4, minW: 6, minH: 3 },
  },

  // --- Communication ---
  {
    id: "widget-announcements",
    label: "Announcements",
    description: "Company-wide announcements and news feed",
    category: "communication",
    icon: "Megaphone",
    defaultGrid: { w: 6, h: 8, minW: 4, minH: 4 },
  },
  {
    id: "widget-team-directory",
    label: "Team Directory",
    description: "Quick access to team members and contacts",
    category: "communication",
    icon: "Users",
    defaultGrid: { w: 6, h: 8, minW: 4, minH: 4 },
  },
  {
    id: "widget-recent-comments",
    label: "Recent Comments",
    description: "Latest comments across all projects and clients",
    category: "communication",
    icon: "MessageSquare",
    defaultGrid: { w: 6, h: 8, minW: 4, minH: 4 },
  },

  // --- Productivity ---
  {
    id: "widget-quick-links",
    label: "Quick Links",
    description: "Bookmarks and shortcuts to frequently used pages",
    category: "productivity",
    icon: "Link",
    defaultGrid: { w: 4, h: 6, minW: 3, minH: 4 },
  },
  {
    id: "widget-calendar",
    label: "Calendar",
    description: "Upcoming events, deadlines, and milestones",
    category: "productivity",
    icon: "Calendar",
    defaultGrid: { w: 6, h: 10, minW: 4, minH: 6 },
  },
  {
    id: "widget-my-tasks",
    label: "My Tasks",
    description: "Tasks assigned to the current user",
    category: "productivity",
    icon: "CheckSquare",
    defaultGrid: { w: 6, h: 10, minW: 4, minH: 4 },
  },
  {
    id: "widget-recent-activity",
    label: "Recent Activity",
    description: "Activity log across the platform",
    category: "productivity",
    icon: "Activity",
    defaultGrid: { w: 6, h: 10, minW: 4, minH: 4 },
  },

  // --- Content & Media ---
  {
    id: "widget-notes",
    label: "Sticky Note",
    description: "Rich text note for reminders or documentation",
    category: "content",
    icon: "StickyNote",
    defaultGrid: { w: 4, h: 6, minW: 3, minH: 3 },
  },
  {
    id: "widget-markdown",
    label: "Markdown Content",
    description: "Render custom markdown content",
    category: "content",
    icon: "FileText",
    defaultGrid: { w: 6, h: 8, minW: 4, minH: 4 },
  },
  {
    id: "widget-embed",
    label: "Embed / iFrame",
    description: "Embed external content via URL",
    category: "content",
    icon: "Globe",
    defaultGrid: { w: 6, h: 10, minW: 4, minH: 4 },
  },

  // --- Data & Lists ---
  {
    id: "widget-recent-projects",
    label: "Recent Projects",
    description: "Recently updated projects across all clients",
    category: "data",
    icon: "FolderKanban",
    defaultGrid: { w: 6, h: 8, minW: 4, minH: 4 },
  },
  {
    id: "widget-recent-contracts",
    label: "Recent Contracts",
    description: "Recently updated or expiring contracts",
    category: "data",
    icon: "FileText",
    defaultGrid: { w: 6, h: 8, minW: 4, minH: 4 },
  },
  {
    id: "widget-recent-documents",
    label: "Recent Documents",
    description: "Latest uploaded or modified documents",
    category: "data",
    icon: "Files",
    defaultGrid: { w: 6, h: 8, minW: 4, minH: 4 },
  },

  // --- Status & Monitoring ---
  {
    id: "widget-project-status",
    label: "Project Status Board",
    description: "Overview of all project statuses at a glance",
    category: "status",
    icon: "Kanban",
    defaultGrid: { w: 12, h: 8, minW: 6, minH: 4 },
  },
  {
    id: "widget-contract-alerts",
    label: "Contract Alerts",
    description: "Expiring and overdue contracts requiring attention",
    category: "status",
    icon: "AlertTriangle",
    defaultGrid: { w: 6, h: 7, minW: 4, minH: 3 },
  },
  {
    id: "widget-countdown",
    label: "Countdown Timer",
    description: "Countdown to an important date or deadline",
    category: "status",
    icon: "Timer",
    defaultGrid: { w: 3, h: 5, minW: 2, minH: 3 },
  },
];

/** Get a global widget definition by ID */
export function getGlobalWidget(id: string): WidgetDefinition | undefined {
  return GLOBAL_WIDGETS.find((w) => w.id === id);
}

/** Check if a card ID is a global widget (vs page-specific) */
export function isGlobalWidget(id: string): boolean {
  return id.startsWith("widget-");
}
