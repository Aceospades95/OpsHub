export interface CardConfig {
  id: string;
  column: "left" | "right" | "full";
  visible: boolean;
  order: number;
}

export interface PageLayoutConfig {
  cards: CardConfig[];
}

export interface CardDefinition {
  id: string;
  label: string;
  defaultColumn: "left" | "right" | "full";
  defaultOrder: number;
}

export const PAGE_CARDS: Record<string, CardDefinition[]> = {
  dashboard: [
    { id: "stats", label: "Stats Cards", defaultColumn: "full", defaultOrder: 0 },
    { id: "alerts", label: "Alerts", defaultColumn: "full", defaultOrder: 1 },
    { id: "my-tasks", label: "My Tasks", defaultColumn: "left", defaultOrder: 2 },
    { id: "activity", label: "Recent Activity", defaultColumn: "right", defaultOrder: 2 },
  ],
  "client-detail": [
    { id: "client-info", label: "Client Info", defaultColumn: "left", defaultOrder: 0 },
    { id: "projects", label: "Projects", defaultColumn: "left", defaultOrder: 1 },
    { id: "contracts", label: "Contracts", defaultColumn: "left", defaultOrder: 2 },
    { id: "comments", label: "Comments", defaultColumn: "left", defaultOrder: 3 },
    { id: "contacts", label: "Contacts", defaultColumn: "right", defaultOrder: 0 },
    { id: "tasks", label: "Tasks", defaultColumn: "right", defaultOrder: 1 },
  ],
  "project-detail": [
    { id: "sub-projects", label: "Sub-Projects", defaultColumn: "left", defaultOrder: 0 },
    { id: "milestones", label: "Milestones", defaultColumn: "left", defaultOrder: 1 },
    { id: "documents", label: "Documents", defaultColumn: "left", defaultOrder: 2 },
    { id: "contracts", label: "Contracts", defaultColumn: "left", defaultOrder: 3 },
    { id: "comments", label: "Comments", defaultColumn: "left", defaultOrder: 4 },
    { id: "team", label: "Team", defaultColumn: "right", defaultOrder: 0 },
    { id: "tasks", label: "Tasks", defaultColumn: "right", defaultOrder: 1 },
    { id: "tools", label: "Tools", defaultColumn: "right", defaultOrder: 2 },
    { id: "attachments", label: "Attachments", defaultColumn: "right", defaultOrder: 3 },
  ],
  "contract-detail": [
    { id: "details", label: "Contract Details", defaultColumn: "left", defaultOrder: 0 },
    { id: "child-contracts", label: "Child Contracts", defaultColumn: "left", defaultOrder: 1 },
    { id: "terms", label: "Contract Terms", defaultColumn: "left", defaultOrder: 2 },
    { id: "comments", label: "Comments", defaultColumn: "left", defaultOrder: 3 },
    { id: "attachments", label: "Attachments", defaultColumn: "right", defaultOrder: 0 },
  ],
};

export function getDefaultLayout(pageType: string): PageLayoutConfig {
  const defs = PAGE_CARDS[pageType] || [];
  return {
    cards: defs.map((d) => ({
      id: d.id,
      column: d.defaultColumn,
      visible: true,
      order: d.defaultOrder,
    })),
  };
}

export function resolveLayout(saved: PageLayoutConfig | null, pageType: string): CardConfig[] {
  const defs = PAGE_CARDS[pageType] || [];
  if (!saved) return getDefaultLayout(pageType).cards;

  const savedMap = new Map(saved.cards.map((c) => [c.id, c]));
  return defs.map((def) => savedMap.get(def.id) || {
    id: def.id, column: def.defaultColumn, visible: true, order: def.defaultOrder,
  });
}

export function getColumnCards(cards: CardConfig[], col: "left" | "right" | "full") {
  return cards.filter((c) => c.column === col && c.visible).sort((a, b) => a.order - b.order);
}
