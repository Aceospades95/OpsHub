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
  SaveAll,
  Trash2,
  BookTemplate,
  SlidersHorizontal,
  ChevronRight,
} from "lucide-react";
import {
  savePageLayout,
  resetPageLayout,
  saveLayoutTemplate,
  loadLayoutTemplate,
  deleteLayoutTemplate,
} from "@/actions/page-layout";
import {
  PAGE_CARDS,
  PAGE_TYPE_LABELS,
  DEFAULT_GAP,
  ROW_HEIGHT,
  type CardConfig,
  type PageLayoutConfig,
  type LayoutTemplate,
} from "@/lib/page-layout";
import {
  GLOBAL_WIDGETS,
  WIDGET_CATEGORY_LABELS,
  type WidgetCategory,
  type WidgetDefinition,
} from "@/lib/widget-registry";
import dynamic from "next/dynamic";

const GridEditorInner = dynamic(
  () => import("./grid-editor-inner").then((mod) => mod.GridEditorInner),
  { ssr: false, loading: () => null }
);

interface CustomWidgetDef {
  id: string;
  label: string;
  description: string;
  category: WidgetCategory;
  icon: string;
  defaultGrid: { w: number; h: number; minW: number; minH: number };
}

interface PageLayoutClientProps {
  pageType: string;
  initialCards: CardConfig[];
  initialGap: number;
  cardLabels: Record<string, string>;
  canEdit: boolean;
  templates: LayoutTemplate[];
  customWidgets?: CustomWidgetDef[];
  children: ReactNode;
}

export function PageLayoutClient({
  pageType,
  initialCards,
  initialGap,
  cardLabels: pageCardLabels,
  canEdit,
  templates: initialTemplates,
  customWidgets = [],
  children,
}: PageLayoutClientProps) {
  const [editing, setEditing] = useState(false);
  const [cards, setCards] = useState<CardConfig[]>(initialCards);
  const [gap, setGap] = useState(initialGap);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [templates, setTemplates] = useState<LayoutTemplate[]>(initialTemplates);
  const [showTemplateMenu, setShowTemplateMenu] = useState(false);
  const [templateName, setTemplateName] = useState("");
  const [showAddWidget, setShowAddWidget] = useState(false);
  const [expandedCategory, setExpandedCategory] = useState<string | null>(null);
  const router = useRouter();

  // Build combined label map: page-specific + global widgets
  const allCardLabels = useMemo(() => {
    const labels = { ...pageCardLabels };
    for (const w of GLOBAL_WIDGETS) {
      labels[w.id] = w.label;
    }
    for (const w of customWidgets) {
      labels[w.id] = w.label;
    }
    return labels;
  }, [pageCardLabels]);

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
  const cardIds = new Set(cards.map((c) => c.id));

  // Page-specific widgets not in layout
  const availablePageWidgets = defs.filter((d) => !cardIds.has(d.id));

  // Global widgets not in layout, grouped by category
  const availableGlobalWidgets = useMemo(() => {
    const available = GLOBAL_WIDGETS.filter((w) => !cardIds.has(w.id));
    const grouped = new Map<WidgetCategory, WidgetDefinition[]>();
    for (const w of available) {
      if (!grouped.has(w.category)) grouped.set(w.category, []);
      grouped.get(w.category)!.push(w);
    }
    return grouped;
  }, [cardIds]);

  // Custom widgets not in layout
  const availableCustomWidgets = useMemo(() => {
    return customWidgets.filter((w) => !cardIds.has(w.id));
  }, [cardIds, customWidgets]);

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

  function addPageWidget(id: string) {
    const def = defs.find((d) => d.id === id);
    if (!def) return;
    const maxY = cards.reduce((max, c) => Math.max(max, c.grid.y + c.grid.h), 0);
    setCards((prev) => [
      ...prev,
      { id, visible: true, grid: { ...def.defaultGrid, y: maxY } },
    ]);
    setShowAddWidget(false);
  }

  function addGlobalWidget(widget: WidgetDefinition) {
    const maxY = cards.reduce((max, c) => Math.max(max, c.grid.y + c.grid.h), 0);
    setCards((prev) => [
      ...prev,
      {
        id: widget.id,
        visible: true,
        grid: { x: 0, y: maxY, ...widget.defaultGrid },
      },
    ]);
    setShowAddWidget(false);
    setExpandedCategory(null);
  }

  function removeWidget(id: string) {
    setCards((prev) => prev.filter((c) => c.id !== id));
  }

  async function handleSave() {
    setSaving(true);
    setMessage("");
    const config: PageLayoutConfig = { cards, gap };
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
    const config: PageLayoutConfig = { cards, gap };
    const result = await saveLayoutTemplate(pageType, templateName.trim(), config);
    if (result.success) {
      setTemplates((prev) => [
        { name: templateName.trim(), pageType, config, createdAt: new Date().toISOString() },
        ...prev.filter((t) => !(t.name === templateName.trim() && t.pageType === pageType)),
      ]);
      setTemplateName("");
      setMessage("Template saved!");
      setTimeout(() => setMessage(""), 2000);
    }
    setSaving(false);
  }

  async function handleLoadTemplate(tpl: LayoutTemplate) {
    setSaving(true);
    const result = await loadLayoutTemplate(pageType, tpl.pageType, tpl.name);
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

  async function handleDeleteTemplate(tpl: LayoutTemplate) {
    await deleteLayoutTemplate(tpl.pageType, tpl.name);
    setTemplates((prev) => prev.filter((t) => !(t.name === tpl.name && t.pageType === tpl.pageType)));
  }

  function handleCancel() {
    setCards(initialCards);
    setGap(initialGap);
    setEditing(false);
    setShowAddWidget(false);
    setShowTemplateMenu(false);
    setExpandedCategory(null);
  }

  // Group templates by source page type
  const templatesByPage = useMemo(() => {
    const grouped = new Map<string, LayoutTemplate[]>();
    for (const t of templates) {
      if (!grouped.has(t.pageType)) grouped.set(t.pageType, []);
      grouped.get(t.pageType)!.push(t);
    }
    return grouped;
  }, [templates]);

  // Hidden cards (visible = false)
  const hiddenCards = cards.filter((c) => !c.visible);

  // ---- View mode ----
  if (!editing) {
    const sortedCards = [...cards]
      .filter((c) => c.visible && cardContentMap[c.id])
      .sort((a, b) => a.grid.y - b.grid.y || a.grid.x - b.grid.x);

    return (
      <>
        <div className="grid grid-cols-12" style={{ gap: `${gap}px`, gridAutoRows: `${ROW_HEIGHT}px` }}>
          {sortedCards.map((card) => (
            <div
              key={card.id}
              style={{
                gridColumn: `${card.grid.x + 1} / span ${card.grid.w}`,
                gridRow: `${card.grid.y + 1} / span ${card.grid.h}`,
              }}
              className="min-h-0 overflow-hidden [&>*]:h-full [&>*]:overflow-auto"
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

  const hasHidden = hiddenCards.length > 0;
  const hasAvailablePage = availablePageWidgets.length > 0;
  const hasAvailableGlobal = availableGlobalWidgets.size > 0;
  const hasAvailableCustom = availableCustomWidgets.length > 0;
  const hasAnythingToAdd = hasHidden || hasAvailablePage || hasAvailableGlobal || hasAvailableCustom;

  return (
    <div className="relative">
      {/* Edit toolbar */}
      <div className="sticky top-0 z-40 bg-card border-2 border-primary/20 rounded-lg px-4 py-3 mb-4 shadow-md">
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-sm font-bold text-primary flex items-center gap-2">
            <Settings2 className="h-4 w-4" /> Editing Layout
          </span>
          <span className="text-xs text-muted-foreground hidden md:inline">
            Drag widgets to move. Grab any edge or corner to resize.
          </span>
          <div className="flex-1" />

          {/* Spacing slider */}
          <div className="flex items-center gap-2">
            <SlidersHorizontal className="h-3.5 w-3.5 text-muted-foreground" />
            <label className="text-xs text-muted-foreground hidden sm:inline">Spacing</label>
            <input
              type="range"
              min={0}
              max={32}
              step={4}
              value={gap}
              onChange={(e) => setGap(Number(e.target.value))}
              className="w-20 h-1.5 accent-primary"
            />
            <span className="text-xs text-muted-foreground w-8">{gap}px</span>
          </div>

          <div className="h-6 w-px bg-border" />

          {/* Add Widget */}
          <div className="relative">
            <Button size="sm" variant="outline" onClick={() => { setShowAddWidget(!showAddWidget); setShowTemplateMenu(false); }}>
              <Plus className="h-4 w-4 mr-1" /> Add Widget
            </Button>
            {showAddWidget && (
              <div className="absolute right-0 top-full mt-1 w-72 bg-card border border-border rounded-lg shadow-lg z-50 py-1 max-h-[70vh] overflow-y-auto">
                {!hasAnythingToAdd ? (
                  <div className="px-3 py-2 text-xs text-muted-foreground">All widgets are active on this page</div>
                ) : (
                  <>
                    {/* Hidden widgets — show first */}
                    {hasHidden && (
                      <>
                        <div className="px-3 py-1.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                          Hidden Widgets
                        </div>
                        {hiddenCards.map((card) => (
                          <button
                            key={card.id}
                            onClick={() => { toggleVisibility(card.id); setShowAddWidget(false); }}
                            className="w-full text-left px-3 py-2 text-sm hover:bg-muted flex items-center gap-2"
                          >
                            <EyeOff className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                            <span className="flex-1 truncate">{allCardLabels[card.id] || card.id}</span>
                            <span className="text-xs text-primary">Show</span>
                          </button>
                        ))}
                      </>
                    )}

                    {/* Page-specific widgets not yet added */}
                    {hasAvailablePage && (
                      <>
                        <div className="px-3 py-1.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mt-1">
                          Page Widgets
                        </div>
                        {availablePageWidgets.map((def) => (
                          <button
                            key={def.id}
                            onClick={() => addPageWidget(def.id)}
                            className="w-full text-left px-3 py-2 text-sm hover:bg-muted flex items-center gap-2"
                          >
                            <Plus className="h-3.5 w-3.5 text-primary shrink-0" />
                            <span className="flex-1 truncate">{def.label}</span>
                            <span className="text-xs text-muted-foreground">Add</span>
                          </button>
                        ))}
                      </>
                    )}

                    {/* Global widgets by category */}
                    {hasAvailableGlobal && (
                      <>
                        {(hasHidden || hasAvailablePage) && <div className="border-t border-border my-1" />}
                        <div className="px-3 py-1.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                          Widget Catalog
                        </div>
                        {Array.from(availableGlobalWidgets.entries()).map(([category, widgets]) => (
                          <div key={category}>
                            <button
                              onClick={() => setExpandedCategory(expandedCategory === category ? null : category)}
                              className="w-full text-left px-3 py-2 text-sm hover:bg-muted flex items-center gap-2 font-medium"
                            >
                              <ChevronRight className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${expandedCategory === category ? "rotate-90" : ""}`} />
                              <span className="flex-1">{WIDGET_CATEGORY_LABELS[category]}</span>
                              <span className="text-xs text-muted-foreground">{widgets.length}</span>
                            </button>
                            {expandedCategory === category && (
                              <div className="pl-4">
                                {widgets.map((w) => (
                                  <button
                                    key={w.id}
                                    onClick={() => addGlobalWidget(w)}
                                    className="w-full text-left px-3 py-2 text-sm hover:bg-muted flex items-start gap-2"
                                  >
                                    <Plus className="h-3.5 w-3.5 text-primary shrink-0 mt-0.5" />
                                    <div className="flex-1 min-w-0">
                                      <div className="font-medium truncate">{w.label}</div>
                                      <div className="text-xs text-muted-foreground line-clamp-1">{w.description}</div>
                                    </div>
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                        ))}
                      </>
                    )}

                    {/* Custom Widgets (built via Widget Builder) */}
                    {hasAvailableCustom && (
                      <>
                        <div className="border-t border-border my-1" />
                        <div className="px-3 py-1.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                          Custom Widgets
                        </div>
                        {availableCustomWidgets.map((w) => (
                          <button
                            key={w.id}
                            onClick={() => {
                              const maxY = cards.reduce((max, c) => Math.max(max, c.grid.y + c.grid.h), 0);
                              setCards((prev) => [...prev, { id: w.id, visible: true, grid: { x: 0, y: maxY, ...w.defaultGrid } }]);
                              setShowAddWidget(false);
                            }}
                            className="w-full text-left px-3 py-2 text-sm hover:bg-muted flex items-start gap-2"
                          >
                            <Plus className="h-3.5 w-3.5 text-accent shrink-0 mt-0.5" />
                            <div className="flex-1 min-w-0">
                              <div className="font-medium truncate">{w.label}</div>
                              {w.description && <div className="text-xs text-muted-foreground line-clamp-1">{w.description}</div>}
                            </div>
                          </button>
                        ))}
                      </>
                    )}
                  </>
                )}
              </div>
            )}
          </div>

          {/* Templates */}
          <div className="relative">
            <Button size="sm" variant="outline" onClick={() => { setShowTemplateMenu(!showTemplateMenu); setShowAddWidget(false); }}>
              <BookTemplate className="h-4 w-4 mr-1" /> Templates
            </Button>
            {showTemplateMenu && (
              <div className="absolute right-0 top-full mt-1 w-80 bg-card border border-border rounded-lg shadow-lg z-50 py-2 max-h-96 overflow-y-auto">
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
                      <SaveAll className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>

                {/* Templates grouped by source page */}
                {templates.length === 0 ? (
                  <div className="px-3 py-2 text-xs text-muted-foreground">No saved templates</div>
                ) : (
                  Array.from(templatesByPage.entries()).map(([pt, tpls]) => (
                    <div key={pt}>
                      <div className="px-3 py-1.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-2">
                        {PAGE_TYPE_LABELS[pt] || pt}
                        {pt !== pageType && (
                          <span className="text-[9px] font-normal normal-case text-muted-foreground/60">(other page)</span>
                        )}
                      </div>
                      {tpls.map((t) => (
                        <div key={`${t.pageType}-${t.name}`} className="flex items-center gap-2 px-3 py-1.5 hover:bg-muted group">
                          <button
                            className="flex-1 text-sm text-left truncate"
                            onClick={() => handleLoadTemplate(t)}
                            title={t.pageType !== pageType ? `Apply "${t.name}" from ${PAGE_TYPE_LABELS[t.pageType] || t.pageType}` : `Load "${t.name}"`}
                          >
                            {t.name}
                          </button>
                          <button
                            onClick={() => handleDeleteTemplate(t)}
                            className="opacity-0 group-hover:opacity-100 text-destructive hover:text-destructive/80 transition-opacity"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      ))}
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
        cardLabels={allCardLabels}
        cardContent={cardContentMap}
        gap={gap}
        onLayoutChange={handleLayoutChange}
        onToggleVisibility={toggleVisibility}
        onRemoveWidget={removeWidget}
      />
    </div>
  );
}
