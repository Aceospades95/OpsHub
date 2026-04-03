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
  // Grid position for drag-and-drop
  grid: GridPosition;
}

export interface PageLayoutConfig {
  cards: CardConfig[];
}

export interface CardDefinition {
  id: string;
  label: string;
  defaultGrid: GridPosition;
}

export const PAGE_CARDS: Record<string, CardDefinition[]> = {
  dashboard: [
    { id: "stats", label: "Stats Cards", defaultGrid: { x: 0, y: 0, w: 12, h: 3, minW: 4, minH: 2 } },
    { id: "alerts", label: "Alerts", defaultGrid: { x: 0, y: 3, w: 12, h: 1, minW: 4, minH: 1 } },
    { id: "my-tasks", label: "My Tasks", defaultGrid: { x: 0, y: 4, w: 6, h: 6, minW: 3, minH: 3 } },
    { id: "activity", label: "Recent Activity", defaultGrid: { x: 6, y: 4, w: 6, h: 6, minW: 3, minH: 3 } },
  ],
  "client-detail": [
    { id: "client-info", label: "Client Info", defaultGrid: { x: 0, y: 0, w: 8, h: 4, minW: 4, minH: 3 } },
    { id: "contacts", label: "Contacts", defaultGrid: { x: 8, y: 0, w: 4, h: 5, minW: 3, minH: 3 } },
    { id: "projects", label: "Projects", defaultGrid: { x: 0, y: 4, w: 8, h: 5, minW: 4, minH: 3 } },
    { id: "tasks", label: "Tasks", defaultGrid: { x: 8, y: 5, w: 4, h: 5, minW: 3, minH: 3 } },
    { id: "contracts", label: "Contracts", defaultGrid: { x: 0, y: 9, w: 8, h: 5, minW: 4, minH: 3 } },
    { id: "comments", label: "Comments", defaultGrid: { x: 0, y: 14, w: 8, h: 5, minW: 4, minH: 3 } },
  ],
  "project-detail": [
    { id: "sub-projects", label: "Sub-Projects", defaultGrid: { x: 0, y: 0, w: 8, h: 5, minW: 4, minH: 3 } },
    { id: "team", label: "Team", defaultGrid: { x: 8, y: 0, w: 4, h: 5, minW: 3, minH: 3 } },
    { id: "milestones", label: "Milestones", defaultGrid: { x: 0, y: 5, w: 8, h: 5, minW: 4, minH: 3 } },
    { id: "tasks", label: "Tasks", defaultGrid: { x: 8, y: 5, w: 4, h: 5, minW: 3, minH: 3 } },
    { id: "documents", label: "Documents", defaultGrid: { x: 0, y: 10, w: 8, h: 4, minW: 4, minH: 3 } },
    { id: "tools", label: "Tools", defaultGrid: { x: 8, y: 10, w: 4, h: 4, minW: 3, minH: 3 } },
    { id: "contracts", label: "Contracts", defaultGrid: { x: 0, y: 14, w: 8, h: 4, minW: 4, minH: 3 } },
    { id: "attachments", label: "Attachments", defaultGrid: { x: 8, y: 14, w: 4, h: 4, minW: 3, minH: 3 } },
    { id: "comments", label: "Comments", defaultGrid: { x: 0, y: 18, w: 12, h: 5, minW: 4, minH: 3 } },
  ],
  "contract-detail": [
    { id: "details", label: "Contract Details", defaultGrid: { x: 0, y: 0, w: 8, h: 6, minW: 4, minH: 3 } },
    { id: "attachments", label: "Attachments", defaultGrid: { x: 8, y: 0, w: 4, h: 6, minW: 3, minH: 3 } },
    { id: "child-contracts", label: "Child Contracts", defaultGrid: { x: 0, y: 6, w: 8, h: 4, minW: 4, minH: 3 } },
    { id: "terms", label: "Contract Terms", defaultGrid: { x: 0, y: 10, w: 8, h: 5, minW: 4, minH: 3 } },
    { id: "comments", label: "Comments", defaultGrid: { x: 0, y: 15, w: 12, h: 5, minW: 4, minH: 3 } },
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
  };
}

export function resolveLayout(saved: PageLayoutConfig | null, pageType: string): CardConfig[] {
  const defs = PAGE_CARDS[pageType] || [];
  if (!saved) return getDefaultLayout(pageType).cards;

  const savedMap = new Map(saved.cards.map((c) => [c.id, c]));
  return defs.map((def) => savedMap.get(def.id) || {
    id: def.id, visible: true, grid: { ...def.defaultGrid },
  });
}
