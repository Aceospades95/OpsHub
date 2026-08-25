export interface GridPosition {
  x: number;
  y: number;
  w: number;   // width in grid units (out of 12)
  h: number;   // height in grid units
  minW?: number;
  minH?: number;
}

export interface CardConfig {
  id: string;
  visible: boolean;
  grid: GridPosition;
}

export interface PageLayoutConfig {
  cards: CardConfig[];
  gap?: number; // spacing between widgets in px (default 16)
}

export interface CardDefinition {
  id: string;
  label: string;
  defaultGrid: GridPosition;
}

export interface LayoutTemplate {
  name: string;
  pageType: string;
  config: PageLayoutConfig;
  createdAt: string;
}

export const DEFAULT_GAP = 12;
export const ROW_HEIGHT = 30;

export const PAGE_TYPE_LABELS: Record<string, string> = {
  dashboard: "Dashboard",
  "client-detail": "Client Detail",
  "project-detail": "Project Detail",
  "contract-detail": "Contract Detail",
  "certification-detail": "Certification Detail",
  "intranet-detail": "Intranet Detail",
  intranet: "Intranet",
};

export const PAGE_CARDS: Record<string, CardDefinition[]> = {
  dashboard: [
    { id: "stats", label: "Stats Cards", defaultGrid: { x: 0, y: 0, w: 12, h: 5, minW: 6, minH: 3 } },
    { id: "alerts", label: "Alerts", defaultGrid: { x: 0, y: 5, w: 12, h: 2, minW: 4, minH: 1 } },
    { id: "renewal-radar", label: "Renewal Radar", defaultGrid: { x: 0, y: 7, w: 12, h: 2, minW: 4, minH: 1 } },
    { id: "my-tasks", label: "My Tasks", defaultGrid: { x: 0, y: 9, w: 4, h: 14, minW: 3, minH: 6 } },
    { id: "projects-overview", label: "Active Projects", defaultGrid: { x: 4, y: 7, w: 4, h: 14, minW: 3, minH: 4 } },
    { id: "team-summary", label: "Team Overview", defaultGrid: { x: 8, y: 7, w: 4, h: 14, minW: 3, minH: 4 } },
    { id: "activity", label: "Recent Activity", defaultGrid: { x: 0, y: 21, w: 12, h: 10, minW: 6, minH: 4 } },
  ],
  "client-detail": [
    { id: "client-info", label: "Client Info", defaultGrid: { x: 0, y: 0, w: 8, h: 8, minW: 4, minH: 4 } },
    { id: "tasks", label: "Tasks", defaultGrid: { x: 8, y: 0, w: 4, h: 8, minW: 3, minH: 4 } },
    { id: "projects", label: "Projects", defaultGrid: { x: 0, y: 8, w: 8, h: 10, minW: 3, minH: 4 } },
    { id: "contacts", label: "Contacts", defaultGrid: { x: 8, y: 8, w: 4, h: 10, minW: 3, minH: 4 } },
    { id: "contracts", label: "Contracts", defaultGrid: { x: 0, y: 18, w: 8, h: 10, minW: 3, minH: 4 } },
    { id: "comments", label: "Comments", defaultGrid: { x: 8, y: 18, w: 4, h: 10, minW: 3, minH: 4 } },
    { id: "quotes", label: "Quotes", defaultGrid: { x: 0, y: 28, w: 12, h: 10, minW: 4, minH: 4 } },
    { id: "bids", label: "Bids", defaultGrid: { x: 0, y: 38, w: 6, h: 9, minW: 3, minH: 4 } },
    { id: "links", label: "Evidence & Links", defaultGrid: { x: 6, y: 38, w: 6, h: 9, minW: 3, minH: 4 } },
  ],
  "project-detail": [
    { id: "team", label: "Staffing", defaultGrid: { x: 0, y: 0, w: 8, h: 9, minW: 4, minH: 4 } },
    { id: "sub-projects", label: "Sub-Projects", defaultGrid: { x: 8, y: 0, w: 4, h: 9, minW: 3, minH: 4 } },
    { id: "milestones", label: "Milestones", defaultGrid: { x: 0, y: 9, w: 6, h: 10, minW: 3, minH: 4 } },
    { id: "tasks", label: "Tasks", defaultGrid: { x: 6, y: 9, w: 6, h: 10, minW: 3, minH: 4 } },
    { id: "documents", label: "Documents", defaultGrid: { x: 0, y: 19, w: 6, h: 9, minW: 3, minH: 4 } },
    { id: "tools", label: "Tools", defaultGrid: { x: 6, y: 19, w: 6, h: 9, minW: 3, minH: 4 } },
    { id: "subcontractors", label: "Subcontractors", defaultGrid: { x: 0, y: 28, w: 6, h: 10, minW: 3, minH: 4 } },
    { id: "partnerships", label: "Partners", defaultGrid: { x: 6, y: 28, w: 6, h: 10, minW: 3, minH: 4 } },
    { id: "contracts", label: "Contracts", defaultGrid: { x: 0, y: 38, w: 6, h: 9, minW: 3, minH: 4 } },
    { id: "related-projects", label: "Related Projects", defaultGrid: { x: 6, y: 38, w: 6, h: 9, minW: 3, minH: 4 } },
    { id: "attachments", label: "Attachments", defaultGrid: { x: 0, y: 47, w: 6, h: 9, minW: 3, minH: 4 } },
    { id: "quotes", label: "Quotes", defaultGrid: { x: 6, y: 47, w: 6, h: 9, minW: 4, minH: 4 } },
    { id: "people", label: "People Involved", defaultGrid: { x: 0, y: 56, w: 6, h: 9, minW: 3, minH: 4 } },
    { id: "comments", label: "Comments", defaultGrid: { x: 0, y: 65, w: 12, h: 10, minW: 4, minH: 4 } },
  ],
  "contract-detail": [
    { id: "details", label: "Contract Details", defaultGrid: { x: 0, y: 0, w: 8, h: 8, minW: 4, minH: 4 } },
    { id: "attachments", label: "Attachments", defaultGrid: { x: 8, y: 0, w: 4, h: 8, minW: 3, minH: 4 } },
    { id: "child-contracts", label: "Child Contracts", defaultGrid: { x: 0, y: 8, w: 12, h: 6, minW: 4, minH: 4 } },
    { id: "terms", label: "Contract Terms", defaultGrid: { x: 0, y: 14, w: 6, h: 8, minW: 3, minH: 4 } },
    { id: "comments", label: "Comments", defaultGrid: { x: 6, y: 14, w: 6, h: 8, minW: 3, minH: 4 } },
  ],
  "intranet-detail": [
    { id: "content", label: "Content", defaultGrid: { x: 0, y: 0, w: 8, h: 12, minW: 4, minH: 4 } },
    { id: "attachments", label: "Attachments", defaultGrid: { x: 8, y: 0, w: 4, h: 12, minW: 3, minH: 4 } },
  ],
  "certification-detail": [
    { id: "overview", label: "Overview", defaultGrid: { x: 0, y: 0, w: 8, h: 10, minW: 4, minH: 4 } },
    { id: "people", label: "People", defaultGrid: { x: 8, y: 0, w: 4, h: 10, minW: 3, minH: 4 } },
    { id: "dates", label: "Dates & Reminders", defaultGrid: { x: 0, y: 10, w: 6, h: 10, minW: 4, minH: 4 } },
    { id: "renewal", label: "Renewal Information", defaultGrid: { x: 6, y: 10, w: 6, h: 10, minW: 4, minH: 4 } },
    { id: "documents", label: "Documents", defaultGrid: { x: 0, y: 20, w: 6, h: 10, minW: 4, minH: 4 } },
    { id: "checklist", label: "Renewal Checklist", defaultGrid: { x: 6, y: 20, w: 6, h: 10, minW: 4, minH: 4 } },
    { id: "agency", label: "Agency Contact", defaultGrid: { x: 0, y: 30, w: 6, h: 8, minW: 3, minH: 4 } },
    { id: "signoff", label: "Sign-Off", defaultGrid: { x: 6, y: 30, w: 6, h: 8, minW: 3, minH: 4 } },
    { id: "renewal-history", label: "Renewal History", defaultGrid: { x: 0, y: 38, w: 12, h: 8, minW: 4, minH: 4 } },
    { id: "audit", label: "Audit Trail", defaultGrid: { x: 0, y: 46, w: 6, h: 10, minW: 4, minH: 4 } },
    { id: "comments", label: "Comments", defaultGrid: { x: 6, y: 46, w: 6, h: 10, minW: 4, minH: 4 } },
  ],
  intranet: [
    { id: "resources", label: "Resources", defaultGrid: { x: 0, y: 0, w: 12, h: 14, minW: 6, minH: 4 } },
  ],
};

export function getDefaultLayout(pageType: string): PageLayoutConfig {
  const defs = PAGE_CARDS[pageType] || [];
  return {
    cards: defs.map((d) => ({
      id: d.id,
      visible: true,
      grid: { ...d.defaultGrid },
    })),
    gap: DEFAULT_GAP,
  };
}

export function resolveLayout(saved: PageLayoutConfig | null, pageType: string): CardConfig[] {
  const defs = PAGE_CARDS[pageType] || [];
  if (!saved) return getDefaultLayout(pageType).cards;

  const savedMap = new Map(saved.cards.map((c) => [c.id, c]));

  // Start with page-specific cards (ensure all defaults exist)
  const result: CardConfig[] = defs.map((def) => savedMap.get(def.id) || {
    id: def.id, visible: true, grid: { ...def.defaultGrid },
  });

  // Add any global widgets from saved config that aren't page-specific
  const pageCardIds = new Set(defs.map((d) => d.id));
  for (const card of saved.cards) {
    if (!pageCardIds.has(card.id)) {
      result.push(card);
    }
  }

  return result;
}
