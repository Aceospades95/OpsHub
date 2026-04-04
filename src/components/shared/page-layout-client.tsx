"use client";

import { useState, useCallback, useMemo, Children, isValidElement, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Settings2,
  Save,
  RotateCcw,
  Eye,
  EyeOff,
  X,
  Plus,
  Copy,
  Trash2,
  BookTemplate,
} from "lucide-react";
import {
  savePageLayout,
  resetPageLayout,
  saveLayoutTemplate,
  loadLayoutTemplate,
  deleteLayoutTemplate,
} from "@/actions/page-layout";
import { PAGE_CARDS, type CardConfig, type PageLayoutConfig, type LayoutTemplate } from "@/lib/page-layout";
import dynamic from "next/dynamic";

const GridEditorInner = dynamic(
  () => import("./grid-editor-inner").then((mod) => mod.GridEditorInner),
  { ssr: false, loading: () => null }
);

interface PageLayoutClientProps {
  pageType: string;
  initialCards: CardConfig[];
  cardLabels: Record<string, string>;
  canEdit: boolean;
  templates: LayoutTemplate[];
  children: ReactNode;
}

export function PageLayoutClient({
  pageType,
  initialCards,
  cardLabels,
  canEdit,
  templates: initialTemplates,
  children,
}: PageLayoutClientProps) {
  const [editing, setEditing] = useState(false);
  const [cards, setCards] = useState<CardConfig[]>(initialCards);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [templates, setTemplates] = useState<LayoutTemplate[]>(initialTemplates);
  const [showTemplateMenu, setShowTemplateMenu] = useState(false);
  const [templateName, setTemplateName] = useState("");
  const [showAddModule, setShowAddModule] = useState(false);
  const router = useRouter();

  // Extract card content from children
  const cardContentMap = useMemo(() => {
    const map: Record<string, ReactNode> = {};
    Children.forEach(children, (child) => {
      if (isValidElement(child) && child.props["data-card-id"]) {
        map[child.props["data-card-id"]] = child.props.children;
      }
    });
    return map;
  }, [children]);

  const defs = PAGE_CARDS[pageType] || [];

  // Cards currently in the layout
  const cardIds = new Set(cards.map((c) => c.id));
  // Available cards not yet added
  const availableCards = defs.filter((d) => !cardIds.has(d.id));

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
    setCards((prev) => prev.map((c) => (c.id === id ? { ...c, visible: !c.visible } : c)));
  }

  function addModule(id: string) {
    const def = defs.find((d) => d.id === id);
    if (!def) return;
    // Place at bottom
    const maxY = cards.reduce((max, c) => Math.max(max, c.grid.y + c.grid.h), 0);
    setCards((prev) => [
      ...prev,
      { id, visible: true, grid: { ...def.defaultGrid, y: maxY } },
    ]);
    setShowAddModule(false);
  }

  function removeModule(id: string) {
    setCards((prev) => prev.filter((c) => c.id !== id));
  }

  async function handleSave() {
    setSaving(true);
    setMessage("");
    const config: PageLayoutConfig = { cards };
    const result = await savePageLayout(pageType, config);
    if (result.success) {
      setMessage("Layout saved!");
      setEditing(false);
      router.refresh();
    } else {
      setMessage(result.error || "Failed to save");
    }
    setSaving(false);
    setTimeout(() => setMessage(""), 2000);
  }

  async function handleReset() {
    setSaving(true);
    await resetPageLayout(pageType);
    setSaving(false);
    setEditing(false);
    router.refresh();
    window.location.reload();
  }

  async function handleSaveTemplate() {
    if (!templateName.trim()) return;
    setSaving(true);
    const config: PageLayoutConfig = { cards };
    const result = await saveLayoutTemplate(pageType, templateName.trim(), config);
    if (result.success) {
      setTemplates((prev) => [
        { name: templateName.trim(), pageType, config, createdAt: new Date().toISOString() },
        ...prev.filter((t) => t.name !== templateName.trim()),
      ]);
      setTemplateName("");
      setMessage("Template saved!");
      setTimeout(() => setMessage(""), 2000);
    }
    setSaving(false);
  }

  async function handleLoadTemplate(name: string) {
    setSaving(true);
    const result = await loadLayoutTemplate(pageType, name);
    if (result.success) {
      setShowTemplateMenu(false);
      setEditing(false);
      router.refresh();
      window.location.reload();
    } else {
      setMessage(result.error || "Failed to load template");
      setTimeout(() => setMessage(""), 2000);
    }
    setSaving(false);
  }

  async function handleDeleteTemplate(name: string) {
    await deleteLayoutTemplate(pageType, name);
    setTemplates((prev) => prev.filter((t) => t.name !== name));
  }

  // ---- View mode: static CSS grid ----
  if (!editing) {
    const sortedCards = [...cards]
      .filter((c) => c.visible && cardContentMap[c.id])
      .sort((a, b) => a.grid.y - b.grid.y || a.grid.x - b.grid.x);

    return (
      <>
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
              {cardContentMap[card.id]}
            </div>
          ))}
        </div>

        {canEdit && (
          <button
            onClick={() => setEditing(true)}
            className="fixed bottom-6 right-6 z-30 flex items-center gap-2 rounded-full bg-primary text-primary-foreground px-4 py-3 shadow-lg hover:bg-primary/90 transition-colors"
            title="Edit page layout"
          >
            <Settings2 className="h-5 w-5" />
            <span className="text-sm font-medium hidden sm:inline">Edit Layout</span>
          </button>
        )}
      </>
    );
  }

  // ---- Edit mode ----
  const visibleCards = cards.filter((c) => c.visible);
  const hiddenCards = cards.filter((c) => !c.visible);

  return (
    <div className="relative">
      {/* Edit toolbar */}
      <div className="sticky top-0 z-40 bg-card border-2 border-primary/20 rounded-lg px-4 py-3 mb-4 shadow-md">
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-sm font-bold text-primary flex items-center gap-2">
            <Settings2 className="h-4 w-4" /> Editing Layout
          </span>
          <span className="text-xs text-muted-foreground hidden sm:inline">
            Drag cards to move. Grab any edge or corner to resize.
          </span>
          <div className="flex-1" />

          {/* Add Module */}
          <div className="relative">
            <Button size="sm" variant="outline" onClick={() => { setShowAddModule(!showAddModule); setShowTemplateMenu(false); }}>
              <Plus className="h-4 w-4 mr-1" /> Add Module
            </Button>
            {showAddModule && (
              <div className="absolute right-0 top-full mt-1 w-56 bg-card border border-border rounded-lg shadow-lg z-50 py-1">
                {availableCards.length === 0 && hiddenCards.length === 0 ? (
                  <div className="px-3 py-2 text-xs text-muted-foreground">All modules are active</div>
                ) : (
                  <>
                    {hiddenCards.map((card) => (
                      <button
                        key={card.id}
                        onClick={() => { toggleVisibility(card.id); setShowAddModule(false); }}
                        className="w-full text-left px-3 py-2 text-sm hover:bg-muted flex items-center gap-2"
                      >
                        <EyeOff className="h-3.5 w-3.5 text-muted-foreground" />
                        {cardLabels[card.id] || card.id}
                        <span className="text-xs text-muted-foreground ml-auto">Show</span>
                      </button>
                    ))}
                    {availableCards.map((def) => (
                      <button
                        key={def.id}
                        onClick={() => addModule(def.id)}
                        className="w-full text-left px-3 py-2 text-sm hover:bg-muted flex items-center gap-2"
                      >
                        <Plus className="h-3.5 w-3.5 text-primary" />
                        {def.label}
                        <span className="text-xs text-muted-foreground ml-auto">Add</span>
                      </button>
                    ))}
                  </>
                )}
              </div>
            )}
          </div>

          {/* Templates */}
          <div className="relative">
            <Button size="sm" variant="outline" onClick={() => { setShowTemplateMenu(!showTemplateMenu); setShowAddModule(false); }}>
              <BookTemplate className="h-4 w-4 mr-1" /> Templates
            </Button>
            {showTemplateMenu && (
              <div className="absolute right-0 top-full mt-1 w-72 bg-card border border-border rounded-lg shadow-lg z-50 py-2">
                {/* Save current as template */}
                <div className="px-3 pb-2 border-b border-border mb-1">
                  <label className="text-xs font-medium text-muted-foreground">Save current layout as template</label>
                  <div className="flex gap-1 mt-1">
                    <input
                      type="text"
                      value={templateName}
                      onChange={(e) => setTemplateName(e.target.value)}
                      placeholder="Template name..."
                      className="flex-1 text-sm px-2 py-1 border border-input rounded bg-background"
                      onKeyDown={(e) => e.key === "Enter" && handleSaveTemplate()}
                    />
                    <Button size="sm" variant="default" onClick={handleSaveTemplate} disabled={!templateName.trim() || saving}>
                      <Copy className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>

                {/* Saved templates */}
                {templates.length === 0 ? (
                  <div className="px-3 py-2 text-xs text-muted-foreground">No saved templates</div>
                ) : (
                  templates.map((t) => (
                    <div key={t.name} className="flex items-center gap-2 px-3 py-1.5 hover:bg-muted group">
                      <button
                        className="flex-1 text-sm text-left truncate"
                        onClick={() => handleLoadTemplate(t.name)}
                      >
                        {t.name}
                      </button>
                      <button
                        onClick={() => handleDeleteTemplate(t.name)}
                        className="opacity-0 group-hover:opacity-100 text-destructive hover:text-destructive/80 transition-opacity"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>

          <div className="h-6 w-px bg-border" />

          <Button size="sm" onClick={handleSave} disabled={saving}>
            <Save className="h-4 w-4 mr-1" /> {saving ? "Saving..." : "Save"}
          </Button>
          <Button variant="outline" size="sm" onClick={handleReset} disabled={saving}>
            <RotateCcw className="h-4 w-4 mr-1" /> Reset Default
          </Button>
          <Button variant="ghost" size="sm" onClick={handleCancel}>
            <X className="h-4 w-4 mr-1" /> Cancel
          </Button>
          {message && <span className="text-sm font-medium text-success">{message}</span>}
        </div>
      </div>

      {/* Grid editor with actual card content */}
      <GridEditorInner
        cards={visibleCards}
        cardLabels={cardLabels}
        cardContent={cardContentMap}
        onLayoutChange={handleLayoutChange}
        onToggleVisibility={toggleVisibility}
        onRemoveModule={removeModule}
      />
    </div>
  );

  function handleCancel() {
    setCards(initialCards);
    setEditing(false);
    setShowAddModule(false);
    setShowTemplateMenu(false);
  }
}
