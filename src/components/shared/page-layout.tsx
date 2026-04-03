import { getPageLayout } from "@/actions/page-layout";
import { resolveLayout, getLeftCards, getRightCards, getFullCards, type CardConfig } from "@/lib/page-layout";
import { LayoutEditor } from "./layout-editor";

interface PageLayoutProps {
  pageType: string;
  cards: Record<string, React.ReactNode>;
  isAdmin: boolean;
}

export async function PageLayout({ pageType, cards, isAdmin }: PageLayoutProps) {
  const savedLayout = await getPageLayout(pageType);
  const resolvedCards = resolveLayout(savedLayout, pageType);

  const fullCards = getFullCards(resolvedCards);
  const leftCards = getLeftCards(resolvedCards);
  const rightCards = getRightCards(resolvedCards);

  const renderCard = (config: CardConfig) => {
    const content = cards[config.id];
    if (!content) return null;
    return <div key={config.id}>{content}</div>;
  };

  return (
    <>
      {/* Full-width cards */}
      {fullCards.length > 0 && (
        <div className="space-y-6 mb-6">
          {fullCards.map(renderCard)}
        </div>
      )}

      {/* Two-column layout */}
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

      {/* Layout editor button for admins */}
      {isAdmin && <LayoutEditor pageType={pageType} currentLayout={resolvedCards} />}
    </>
  );
}
