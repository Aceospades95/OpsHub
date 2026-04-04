import { getPageLayout, getAllLayoutTemplates } from "@/actions/page-layout";
import { resolveLayout, PAGE_CARDS, DEFAULT_GAP, type LayoutTemplate } from "@/lib/page-layout";
import { PageLayoutClient } from "./page-layout-client";

interface PageLayoutProps {
  pageType: string;
  cards: Record<string, React.ReactNode>;
  canEdit: boolean;
}

export async function PageLayout({ pageType, cards, canEdit }: PageLayoutProps) {
  const savedLayout = await getPageLayout(pageType);
  const resolvedCards = resolveLayout(savedLayout, pageType);
  const savedGap = savedLayout?.gap ?? DEFAULT_GAP;
  const defs = PAGE_CARDS[pageType] || [];

  // Build label map from definitions
  const cardLabels: Record<string, string> = {};
  for (const d of defs) {
    cardLabels[d.id] = d.label;
  }

  // Fetch ALL templates across all pages if user can edit
  let templates: LayoutTemplate[] = [];
  if (canEdit) {
    templates = await getAllLayoutTemplates();
  }

  return (
    <PageLayoutClient
      pageType={pageType}
      initialCards={resolvedCards}
      initialGap={savedGap}
      cardLabels={cardLabels}
      canEdit={canEdit}
      templates={templates}
    >
      {Object.entries(cards).map(([id, node]) => (
        <div key={id} data-card-id={id}>
          {node}
        </div>
      ))}
    </PageLayoutClient>
  );
}
