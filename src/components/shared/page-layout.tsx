import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { getPageLayout, getAllLayoutTemplates } from "@/actions/page-layout";
import { resolveLayout, PAGE_CARDS, DEFAULT_GAP, type LayoutTemplate } from "@/lib/page-layout";
import { isGlobalWidget } from "@/lib/widget-registry";
import { WidgetRenderer } from "@/components/widgets/widget-renderer";
import { PageLayoutClient } from "./page-layout-client";
import type { WidgetCategory } from "@/lib/widget-registry";

interface PageLayoutProps {
  pageType: string;
  cards: Record<string, React.ReactNode>;
  canEdit: boolean;
  /**
   * "grid" = fixed-height widget grid (dashboard). Cards have explicit
   *   x/y/w/h positions and scroll internally when content overflows.
   * "flow" = auto-expanding responsive layout (detail pages). Cards size
   *   to their content with no fixed height. Uses column widths from the
   *   card definitions but auto-places vertically.
   */
  mode?: "grid" | "flow";
}

export async function PageLayout({ pageType, cards, canEdit, mode = "grid" }: PageLayoutProps) {
  const session = await auth();
  const userId = session?.user?.id || "";

  const savedLayout = await getPageLayout(pageType);
  const resolvedCards = resolveLayout(savedLayout, pageType);
  const savedGap = savedLayout?.gap ?? DEFAULT_GAP;
  const defs = PAGE_CARDS[pageType] || [];

  // Build label map from page-specific definitions
  const cardLabels: Record<string, string> = {};
  for (const d of defs) {
    cardLabels[d.id] = d.label;
  }

  // Render global/custom widgets that are in the layout
  const allCards = { ...cards };
  for (const card of resolvedCards) {
    if (isGlobalWidget(card.id) && !allCards[card.id]) {
      allCards[card.id] = <WidgetRenderer widgetId={card.id} userId={userId} />;
    }
  }

  // Fetch ALL templates across all pages if user can edit
  let templates: LayoutTemplate[] = [];
  let customWidgetDefs: { id: string; label: string; description: string; category: WidgetCategory; icon: string; defaultGrid: { w: number; h: number; minW: number; minH: number } }[] = [];

  if (canEdit) {
    templates = await getAllLayoutTemplates();

    // Load published custom widgets for the catalog
    try {
      const published = await db.customWidget.findMany({
        where: { isPublished: true },
        select: { id: true, name: true, description: true, category: true, icon: true },
        orderBy: { name: "asc" },
      });
      customWidgetDefs = published.map((w) => ({
        id: `custom-widget-${w.id}`,
        label: w.name,
        description: w.description || "",
        category: (w.category || "data") as WidgetCategory,
        icon: w.icon || "BarChart3",
        defaultGrid: { w: 6, h: 8, minW: 3, minH: 4 },
      }));
    } catch {
      // DB not available during build
    }
  }

  return (
    <PageLayoutClient
      pageType={pageType}
      initialCards={resolvedCards}
      initialGap={savedGap}
      cardLabels={cardLabels}
      canEdit={canEdit}
      templates={templates}
      customWidgets={customWidgetDefs}
      mode={mode}
    >
      {Object.entries(allCards).map(([id, node]) => (
        <div key={id} data-card-id={id}>
          {node}
        </div>
      ))}
    </PageLayoutClient>
  );
}
