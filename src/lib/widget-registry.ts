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
  // widget-notes, widget-markdown, widget-countdown, and widget-embed
  // were placeholder shells whose UIs only said "coming soon" / asked
  // for config that no config layer exists to provide — they shipped to
  // prod before their config layer existed. Pulled from the registry so
  // admins don't add a half-empty card to their dashboard. The
  // component files are still here so an existing layout that
  // referenced them by id renders empty rather than crashing; once
  // their config UI lands, re-adding the entries here re-enables the
  // catalog. See widget-renderer.tsx for the runtime side.

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
  {
    id: "widget-recently-viewed",
    label: "Recently Viewed",
    description:
      "Quick re-entry into projects, clients, and employees you opened recently. Stored per-browser; no DB sync.",
    category: "data",
    icon: "History",
    defaultGrid: { w: 4, h: 8, minW: 3, minH: 4 },
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
  // widget-countdown was a placeholder hardcoded to "30 days" with no
  // configurable target — see the comment above on widget-notes /
  // widget-markdown. Re-add to the registry once the config UI ships.
];

/** Get a global widget definition by ID */
export function getGlobalWidget(id: string): WidgetDefinition | undefined {
  return GLOBAL_WIDGETS.find((w) => w.id === id);
}

/** Check if a card ID is a custom (user-built) widget */
export function isCustomWidget(id: string): boolean {
  return id.startsWith("custom-widget-");
}

/** Check if a card ID is a global widget (hardcoded or custom) */
export function isGlobalWidget(id: string): boolean {
  return id.startsWith("widget-") || id.startsWith("custom-widget-");
}
