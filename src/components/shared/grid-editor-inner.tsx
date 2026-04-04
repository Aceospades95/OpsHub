"use client";

import { useCallback, type ReactNode } from "react";
import * as RGL from "react-grid-layout";
import { Eye, Trash2, GripVertical } from "lucide-react";

const ResponsiveGridLayout =
  RGL.ResponsiveGridLayout || RGL.Responsive || (RGL as Record<string, unknown>).default;
const useContainerWidth = RGL.useContainerWidth;
const verticalCompactor = RGL.verticalCompactor;

interface GridEditorInnerProps {
  cards: { id: string; visible: boolean; grid: { x: number; y: number; w: number; h: number; minW?: number; minH?: number } }[];
  cardLabels: Record<string, string>;
  cardContent: Record<string, ReactNode>;
  onLayoutChange: (layout: readonly { i: string; x: number; y: number; w: number; h: number }[]) => void;
  onToggleVisibility: (id: string) => void;
  onRemoveModule: (id: string) => void;
}

export function GridEditorInner({
  cards,
  cardLabels,
  cardContent,
  onLayoutChange,
  onToggleVisibility,
  onRemoveModule,
}: GridEditorInnerProps) {
  const { width: containerWidth, containerRef } = useContainerWidth({ initialWidth: 1200 });

  const handleChange = useCallback(
    (layout: readonly { i: string; x: number; y: number; w: number; h: number }[]) => {
      onLayoutChange(layout);
    },
    [onLayoutChange]
  );

  const gridLayout = cards.map((c) => ({
    i: c.id,
    x: c.grid.x,
    y: c.grid.y,
    w: c.grid.w,
    h: c.grid.h,
    minW: c.grid.minW || 2,
    minH: c.grid.minH || 2,
    resizeHandles: ["s", "w", "e", "n", "sw", "nw", "se", "ne"] as ("s" | "w" | "e" | "n" | "sw" | "nw" | "se" | "ne")[],
  }));

  return (
    <div ref={containerRef as React.RefObject<HTMLDivElement>}>
      <ResponsiveGridLayout
        layouts={{ lg: gridLayout }}
        breakpoints={{ lg: 1024, md: 768, sm: 480 }}
        cols={{ lg: 12, md: 8, sm: 4 }}
        rowHeight={50}
        width={containerWidth || 1200}
        dragConfig={{ enabled: true, bounded: false, handle: ".drag-handle", threshold: 3 }}
        resizeConfig={{ enabled: true }}
        onLayoutChange={(layout: readonly { i: string; x: number; y: number; w: number; h: number }[]) => handleChange(layout)}
        compactor={verticalCompactor}
        margin={[12, 12] as [number, number]}
      >
        {cards.map((card) => (
          <div key={card.id}>
            <div className="h-full rounded-lg border-2 border-dashed border-primary/30 bg-card shadow-sm overflow-hidden relative group">
              {/* Card header with drag handle and controls */}
              <div className="drag-handle flex items-center gap-2 px-3 py-1.5 bg-primary/5 cursor-grab active:cursor-grabbing border-b border-primary/10 relative z-10">
                <GripVertical className="h-4 w-4 text-primary/40 shrink-0" />
                <span className="text-xs font-semibold text-primary/70 flex-1 truncate">
                  {cardLabels[card.id] || card.id}
                </span>
                <button
                  onClick={() => onToggleVisibility(card.id)}
                  className="text-muted-foreground hover:text-warning transition-colors p-0.5"
                  title="Hide this module"
                >
                  <Eye className="h-4 w-4" />
                </button>
                <button
                  onClick={() => onRemoveModule(card.id)}
                  className="text-muted-foreground hover:text-destructive transition-colors p-0.5"
                  title="Remove this module"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
              {/* Actual card content */}
              <div className="overflow-auto" style={{ height: "calc(100% - 34px)" }}>
                {cardContent[card.id] || (
                  <div className="flex items-center justify-center h-full text-muted-foreground/40 text-sm">
                    {cardLabels[card.id] || card.id}
                  </div>
                )}
              </div>
            </div>
          </div>
        ))}
      </ResponsiveGridLayout>
    </div>
  );
}
