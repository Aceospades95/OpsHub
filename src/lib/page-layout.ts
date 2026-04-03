export interface CardConfig {
  id: string;
  column: "left" | "right" | "full";
  visible: boolean;
  order: number;
}

export interface PageLayoutConfig {
  cards: CardConfig[];
}

// Registry of available cards per page type
export interface CardDefinition {
  id: string;
  label: string;
  defaultColumn: "left" | "right" | "full";
  defaultOrder: number;
}

// Default card definitions per page
export const PAGE_CARDS: Record<string, CardDefinition[]> = {
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
    { id: "tasks", label: "Tasks", defaultColumn: "left", defaultOrder: 2 },
    { id: "documents", label: "Documents", defaultColumn: "left", defaultOrder: 3 },
    { id: "contracts", label: "Contracts", defaultColumn: "left", defaultOrder: 4 },
    { id: "comments", label: "Comments", defaultColumn: "left", defaultOrder: 5 },
    { id: "team", label: "Team", defaultColumn: "right", defaultOrder: 0 },
    { id: "tools", label: "Tools", defaultColumn: "right", defaultOrder: 1 },
    { id: "attachments", label: "Attachments", defaultColumn: "right", defaultOrder: 2 },
  ],
  "contract-detail": [
    { id: "details", label: "Contract Details", defaultColumn: "left", defaultOrder: 0 },
    { id: "child-contracts", label: "Child Contracts", defaultColumn: "left", defaultOrder: 1 },
    { id: "terms", label: "Contract Terms", defaultColumn: "left", defaultOrder: 2 },
    { id: "comments", label: "Comments", defaultColumn: "left", defaultOrder: 3 },
    { id: "attachments", label: "Attachments", defaultColumn: "right", defaultOrder: 0 },
  ],
  dashboard: [
    { id: "stats", label: "Stats Cards", defaultColumn: "full", defaultOrder: 0 },
    { id: "alerts", label: "Alerts", defaultColumn: "full", defaultOrder: 1 },
    { id: "my-tasks", label: "My Tasks", defaultColumn: "left", defaultOrder: 2 },
    { id: "activity", label: "Recent Activity", defaultColumn: "right", defaultOrder: 2 },
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

export function resolveLayout(
  saved: PageLayoutConfig | null,
  pageType: string
): CardConfig[] {
  const defs = PAGE_CARDS[pageType] || [];
  const defaultLayout = getDefaultLayout(pageType);

  if (!saved) return defaultLayout.cards;

  // Merge: use saved positions but ensure all cards exist
  const savedMap = new Map(saved.cards.map((c) => [c.id, c]));
  const merged: CardConfig[] = [];

  for (const def of defs) {
    const savedCard = savedMap.get(def.id);
    if (savedCard) {
      merged.push(savedCard);
    } else {
      // New card added since layout was saved
      merged.push({
        id: def.id,
        column: def.defaultColumn,
        visible: true,
        order: def.defaultOrder,
      });
    }
  }

  return merged;
}

export function getLeftCards(cards: CardConfig[]): CardConfig[] {
  return cards.filter((c) => c.column === "left" && c.visible).sort((a, b) => a.order - b.order);
}

export function getRightCards(cards: CardConfig[]): CardConfig[] {
  return cards.filter((c) => c.column === "right" && c.visible).sort((a, b) => a.order - b.order);
}

export function getFullCards(cards: CardConfig[]): CardConfig[] {
  return cards.filter((c) => c.column === "full" && c.visible).sort((a, b) => a.order - b.order);
}
