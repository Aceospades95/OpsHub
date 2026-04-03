import { getPageLayout } from "@/actions/page-layout";
import { resolveLayout, type CardConfig } from "@/lib/page-layout";
import { GridEditor } from "./grid-editor-loader";

interface PageLayoutProps {
  pageType: string;
  cards: Record<string, React.ReactNode>;
  canEdit: boolean;
}

export async function PageLayout({ pageType, cards, canEdit }: PageLayoutProps) {
  const savedLayout = await getPageLayout(pageType);
  const resolvedCards = resolveLayout(savedLayout, pageType);

  // Sort by y then x for proper rendering order
  const sortedCards = [...resolvedCards]
    .filter((c) => c.visible && cards[c.id])
    .sort((a, b) => a.grid.y - b.grid.y || a.grid.x - b.grid.x);

  // Static server render: use CSS grid with explicit positions
  const cardLabels: Record<string, string> = {};
  for (const c of resolvedCards) {
    cardLabels[c.id] = c.id;
  }

  return (
    <>
      {/* Normal view: static CSS grid */}
      <div className="grid grid-cols-12 gap-4 auto-rows-[50px]">
        {sortedCards.map((card) => (
          <div
            key={card.id}
            style={{
              gridColumn: `${card.grid.x + 1} / span ${card.grid.w}`,
              gridRow: `${card.grid.y + 1} / span ${card.grid.h}`,
            }}
            className="min-h-0 overflow-hidden"
          >
            {cards[card.id]}
          </div>
        ))}
      </div>

      {/* Edit button + drag grid overlay (client-only, DEVELOPER/ADMIN) */}
      {canEdit && (
        <GridEditor
          pageType={pageType}
          initialCards={resolvedCards}
          cardLabels={Object.fromEntries(
            resolvedCards.map((c) => [c.id, c.id])
          )}
        />
      )}
    </>
  );
}
