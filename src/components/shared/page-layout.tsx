import { getPageLayout } from "@/actions/page-layout";
import { resolveLayout, getColumnCards, type CardConfig } from "@/lib/page-layout";
import { LayoutEditor } from "./layout-editor";

interface PageLayoutProps {
  pageType: string;
  cards: Record<string, React.ReactNode>;
  canEdit: boolean;
}

export async function PageLayout({ pageType, cards, canEdit }: PageLayoutProps) {
  const savedLayout = await getPageLayout(pageType);
  const resolvedCards = resolveLayout(savedLayout, pageType);

  const fullCards = getColumnCards(resolvedCards, "full");
  const leftCards = getColumnCards(resolvedCards, "left");
  const rightCards = getColumnCards(resolvedCards, "right");

  const renderCard = (config: CardConfig) => {
    const content = cards[config.id];
    if (!content) return null;
    return <div key={config.id}>{content}</div>;
  };

  return (
    <>
      {fullCards.length > 0 && (
        <div className="space-y-6 mb-6">
          {fullCards.map(renderCard)}
        </div>
      )}

      {(leftCards.length > 0 || rightCards.length > 0) && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          {leftCards.length > 0 && (
            <div className="lg:col-span-2 space-y-6">
              {leftCards.map(renderCard)}
            </div>
          )}
          {rightCards.length > 0 && (
            <div className="space-y-6">
              {rightCards.map(renderCard)}
            </div>
          )}
        </div>
      )}

      {canEdit && <LayoutEditor pageType={pageType} currentLayout={resolvedCards} />}
    </>
  );
}
