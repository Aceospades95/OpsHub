"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import {
  Settings2,
  ChevronUp,
  ChevronDown,
  Eye,
  EyeOff,
  ArrowLeftRight,
  RotateCcw,
} from "lucide-react";
import { savePageLayout, resetPageLayout } from "@/actions/page-layout";
import { PAGE_CARDS, type CardConfig, type PageLayoutConfig } from "@/lib/page-layout";

interface LayoutEditorProps {
  pageType: string;
  currentLayout: CardConfig[];
}

const COLUMN_LABELS: Record<string, string> = {
  left: "Left",
  right: "Right",
  full: "Full Width",
};

const COLUMN_CYCLE: Record<string, "left" | "right" | "full"> = {
  left: "right",
  right: "full",
  full: "left",
};

export function LayoutEditor({ pageType, currentLayout }: LayoutEditorProps) {
  const [open, setOpen] = useState(false);
  const [cards, setCards] = useState<CardConfig[]>(currentLayout);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const router = useRouter();

  const cardDefs = PAGE_CARDS[pageType] || [];
  const labelMap = new Map(cardDefs.map((d) => [d.id, d.label]));

  function moveCard(index: number, direction: -1 | 1) {
    // Find same-column cards and swap within column
    const card = cards[index];
    const sameColumn = cards
      .map((c, i) => ({ ...c, originalIndex: i }))
      .filter((c) => c.column === card.column)
      .sort((a, b) => a.order - b.order);

    const posInColumn = sameColumn.findIndex((c) => c.originalIndex === index);
    const targetPos = posInColumn + direction;
    if (targetPos < 0 || targetPos >= sameColumn.length) return;

    const newCards = [...cards];
    const swapIndex = sameColumn[targetPos].originalIndex;
    const tempOrder = newCards[index].order;
    newCards[index] = { ...newCards[index], order: newCards[swapIndex].order };
    newCards[swapIndex] = { ...newCards[swapIndex], order: tempOrder };
    setCards(newCards);
  }

  function toggleVisibility(index: number) {
    setCards((prev) =>
      prev.map((c, i) => (i === index ? { ...c, visible: !c.visible } : c))
    );
  }

  function cycleColumn(index: number) {
    setCards((prev) =>
      prev.map((c, i) =>
        i === index ? { ...c, column: COLUMN_CYCLE[c.column] } : c
      )
    );
  }

  async function handleSave() {
    setSaving(true);
    setMessage("");
    const config: PageLayoutConfig = { cards };
    const result = await savePageLayout(pageType, config);
    if (result.success) {
      setMessage("Layout saved!");
      router.refresh();
      setTimeout(() => setOpen(false), 500);
    } else {
      setMessage(result.error || "Failed to save");
    }
    setSaving(false);
  }

  async function handleReset() {
    setSaving(true);
    const result = await resetPageLayout(pageType);
    if (result.success) {
      router.refresh();
      window.location.reload();
    }
    setSaving(false);
  }

  // Group cards by column for display
  const grouped = {
    left: cards.filter((c) => c.column === "left").sort((a, b) => a.order - b.order),
    right: cards.filter((c) => c.column === "right").sort((a, b) => a.order - b.order),
    full: cards.filter((c) => c.column === "full").sort((a, b) => a.order - b.order),
  };

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-6 right-6 z-30 flex items-center gap-2 rounded-full bg-primary text-primary-foreground px-4 py-3 shadow-lg hover:bg-primary/90 transition-colors"
        title="Edit page layout"
      >
        <Settings2 className="h-5 w-5" />
        <span className="text-sm font-medium hidden sm:inline">Edit Layout</span>
      </button>

      <Dialog open={open} onClose={() => setOpen(false)} title="Edit Page Layout">
        <div className="space-y-6">
          {(["full", "left", "right"] as const).map((column) => {
            const columnCards = grouped[column];
            if (columnCards.length === 0) return null;
            return (
              <div key={column}>
                <h3 className="text-sm font-semibold text-muted-foreground mb-2 uppercase tracking-wider">
                  {COLUMN_LABELS[column]} Column
                </h3>
                <div className="space-y-1.5">
                  {columnCards.map((card) => {
                    const globalIndex = cards.findIndex((c) => c.id === card.id);
                    const posInCol = columnCards.indexOf(card);
                    return (
                      <div
                        key={card.id}
                        className={`flex items-center gap-3 rounded border border-border px-3 py-2.5 ${
                          card.visible ? "bg-card" : "bg-muted opacity-60"
                        }`}
                      >
                        <span className={`flex-1 text-sm ${card.visible ? "font-medium" : "line-through text-muted-foreground"}`}>
                          {labelMap.get(card.id) || card.id}
                        </span>
                        <div className="flex items-center gap-1 shrink-0">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-9 w-9 p-0"
                            onClick={() => moveCard(globalIndex, -1)}
                            disabled={posInCol === 0}
                            title="Move up"
                          >
                            <ChevronUp className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-9 w-9 p-0"
                            onClick={() => moveCard(globalIndex, 1)}
                            disabled={posInCol === columnCards.length - 1}
                            title="Move down"
                          >
                            <ChevronDown className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-9 w-9 p-0"
                            onClick={() => cycleColumn(globalIndex)}
                            title={`Move to ${COLUMN_LABELS[COLUMN_CYCLE[card.column]]}`}
                          >
                            <ArrowLeftRight className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-9 w-9 p-0"
                            onClick={() => toggleVisibility(globalIndex)}
                            title={card.visible ? "Hide" : "Show"}
                          >
                            {card.visible ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}

          {message && (
            <p className={`text-sm ${message.includes("saved") ? "text-success" : "text-destructive"}`}>
              {message}
            </p>
          )}

          <div className="flex items-center gap-3 pt-2 border-t border-border">
            <Button onClick={handleSave} disabled={saving}>
              {saving ? "Saving..." : "Save Layout"}
            </Button>
            <Button variant="outline" onClick={handleReset} disabled={saving}>
              <RotateCcw className="h-4 w-4 mr-1" /> Reset
            </Button>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>
        </div>
      </Dialog>
    </>
  );
}
