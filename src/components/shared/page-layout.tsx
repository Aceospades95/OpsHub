import { getPageLayout, getLayoutTemplates } from "@/actions/page-layout";
import { resolveLayout, PAGE_CARDS, type CardConfig, type LayoutTemplate } from "@/lib/page-layout";
import { PageLayoutClient } from "./page-layout-client";

interface PageLayoutProps {
  pageType: string;
  cards: Record<string, React.ReactNode>;
  canEdit: boolean;
}

export async function PageLayout({ pageType, cards, canEdit }: PageLayoutProps) {
  const savedLayout = await getPageLayout(pageType);
  const resolvedCards = resolveLayout(savedLayout, pageType);
  const defs = PAGE_CARDS[pageType] || [];

  // Build label map from definitions
  const cardLabels: Record<string, string> = {};
  for (const d of defs) {
    cardLabels[d.id] = d.label;
  }

  // Fetch templates if user can edit
  let templates: LayoutTemplate[] = [];
  if (canEdit) {
    templates = await getLayoutTemplates(pageType);
  }

  return (
    <PageLayoutClient
      pageType={pageType}
      initialCards={resolvedCards}
      cardLabels={cardLabels}
      canEdit={canEdit}
      templates={templates}
    >
      {/* Pass card content as children keyed by data-card-id */}
      {Object.entries(cards).map(([id, node]) => (
        <div key={id} data-card-id={id}>
          {node}
        </div>
      ))}
    </PageLayoutClient>
  );
}
