"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import * as RGL from "react-grid-layout";
const ResponsiveGridLayout = RGL.ResponsiveGridLayout || RGL.Responsive || (RGL as Record<string, unknown>).default;
const useContainerWidth = RGL.useContainerWidth;
const verticalCompactor = RGL.verticalCompactor;
import { Button } from "@/components/ui/button";
import { Settings2, Save, RotateCcw, Eye, EyeOff, X } from "lucide-react";
import { savePageLayout, resetPageLayout } from "@/actions/page-layout";
import { PAGE_CARDS, type CardConfig, type PageLayoutConfig } from "@/lib/page-layout";

interface GridEditorProps {
  pageType: string;
  initialCards: CardConfig[];
  cardLabels: Record<string, string>;
}

export function GridEditor({ pageType, initialCards, cardLabels }: GridEditorProps) {
  const [editing, setEditing] = useState(false);
  const [cards, setCards] = useState<CardConfig[]>(initialCards);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const router = useRouter();
  const { width: containerWidth, containerRef } = useContainerWidth({ initialWidth: 1200 });

  const defs = PAGE_CARDS[pageType] || [];
  const labelMap = new Map(defs.map((d) => [d.id, d.label]));

  const handleLayoutChange = useCallback(
    (layout: readonly { i: string; x: number; y: number; w: number; h: number }[]) => {
      setCards((prev) =>
        prev.map((card) => {
          const item = layout.find((l) => l.i === card.id);
          if (!item) return card;
          return { ...card, grid: { ...card.grid, x: item.x, y: item.y, w: item.w, h: item.h } };
        })
      );
    },
    []
  );

  function toggleVisibility(id: string) {
    setCards((prev) => prev.map((c) => c.id === id ? { ...c, visible: !c.visible } : c));
  }

  async function handleSave() {
    setSaving(true);
    setMessage("");
    const config: PageLayoutConfig = { cards };
    const result = await savePageLayout(pageType, config);
    if (result.success) {
      setMessage("Saved!");
      setEditing(false);
      router.refresh();
    } else {
      setMessage(result.error || "Failed");
    }
    setSaving(false);
    setTimeout(() => setMessage(""), 2000);
  }

  async function handleReset() {
    setSaving(true);
    await resetPageLayout(pageType);
    setSaving(false);
    router.refresh();
    window.location.reload();
  }

  function handleCancel() {
    setCards(initialCards);
    setEditing(false);
  }

  if (!editing) {
    return (
      <button
        onClick={() => setEditing(true)}
        className="fixed bottom-6 right-6 z-30 flex items-center gap-2 rounded-full bg-primary text-primary-foreground px-4 py-3 shadow-lg hover:bg-primary/90 transition-colors"
        title="Customize this page's layout — show/hide cards and reorder them. Saves to your account so it persists across sessions."
        aria-label="Customize page layout"
      >
        <Settings2 className="h-5 w-5" />
        <span className="text-sm font-medium hidden sm:inline">Edit Layout</span>
      </button>
    );
  }

  const visibleCards = cards.filter((c) => c.visible);
  const hiddenCards = cards.filter((c) => !c.visible);

  const gridLayout = visibleCards.map((c) => ({
    i: c.id,
    x: c.grid.x,
    y: c.grid.y,
    w: c.grid.w,
    h: c.grid.h,
    minW: c.grid.minW || 2,
    minH: c.grid.minH || 2,
  }));

  return (
    <div className="fixed inset-0 z-50 bg-background/95 overflow-y-auto">
      {/* Toolbar */}
      <div className="sticky top-0 z-10 bg-card border-b border-border px-4 py-3 flex items-center gap-3 flex-wrap shadow-sm">
        <span className="text-sm font-semibold text-primary">Editing Layout</span>
        <span className="text-xs text-muted-foreground">Drag cards to reposition. Grab corners to resize.</span>
        <div className="flex-1" />
        <Button size="sm" onClick={handleSave} disabled={saving}>
          <Save className="h-4 w-4 mr-1" /> {saving ? "Saving..." : "Save"}
        </Button>
        <Button variant="outline" size="sm" onClick={handleReset} disabled={saving}>
          <RotateCcw className="h-4 w-4 mr-1" /> Reset
        </Button>
        <Button variant="ghost" size="sm" onClick={handleCancel}>
          <X className="h-4 w-4 mr-1" /> Cancel
        </Button>
        {message && <span className="text-sm text-success">{message}</span>}
      </div>

      {/* Hidden cards bar */}
      {hiddenCards.length > 0 && (
        <div className="px-4 py-2 bg-muted border-b border-border flex items-center gap-2 flex-wrap">
          <span className="text-xs text-muted-foreground font-medium">Hidden:</span>
          {hiddenCards.map((card) => (
            <button
              key={card.id}
              onClick={() => toggleVisibility(card.id)}
              className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded bg-card border border-border text-muted-foreground hover:text-foreground transition-colors"
            >
              <EyeOff className="h-3 w-3" />
              {labelMap.get(card.id) || card.id}
            </button>
          ))}
        </div>
      )}

      {/* Grid */}
      <div className="p-4" ref={containerRef as React.RefObject<HTMLDivElement>}>
        <ResponsiveGridLayout
          layouts={{ lg: gridLayout }}
          breakpoints={{ lg: 1024, md: 768, sm: 480 }}
          cols={{ lg: 12, md: 8, sm: 4 }}
          rowHeight={50}
          width={containerWidth || 1200}
          dragConfig={{ enabled: true, bounded: false, handle: ".drag-handle", threshold: 3 }}
          resizeConfig={{ enabled: true }}
          onLayoutChange={(layout) => handleLayoutChange(layout)}
          compactor={verticalCompactor}
          margin={[12, 12] as [number, number]}
        >
          {visibleCards.map((card) => (
            <div key={card.id}>
              <div className="h-full rounded-lg border-2 border-dashed border-primary/30 bg-card shadow-sm overflow-hidden relative">
                {/* Drag handle */}
                <div className="drag-handle flex items-center justify-between px-3 py-2 bg-primary/5 cursor-grab active:cursor-grabbing border-b border-primary/10">
                  <span className="text-xs font-semibold text-primary/70">
                    {labelMap.get(card.id) || card.id}
                  </span>
                  <button
                    onClick={() => toggleVisibility(card.id)}
                    className="text-muted-foreground hover:text-destructive transition-colors"
                    title="Hide this card"
                  >
                    <Eye className="h-3.5 w-3.5" />
                  </button>
                </div>
                {/* Placeholder content */}
                <div className="flex items-center justify-center h-[calc(100%-36px)] text-muted-foreground/40 text-sm">
                  {labelMap.get(card.id) || card.id}
                </div>
              </div>
            </div>
          ))}
        </ResponsiveGridLayout>
      </div>
    </div>
  );
}
