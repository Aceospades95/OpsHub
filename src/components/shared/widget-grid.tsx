"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { ResponsiveGridLayout, useContainerWidth, verticalCompactor } from "react-grid-layout";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  Settings2, Plus, Save, RotateCcw, X, Trash2, BookmarkPlus,
  type LucideIcon,
} from "lucide-react";
import {
  saveWidgetLayout,
  resetWidgetLayout,
  saveWidgetTemplate,
  getWidgetTemplates,
  deleteWidgetTemplate,
  type WidgetTemplate,
} from "@/actions/widgets";
import {
  WIDGET_TYPE_INFO,
  QUERYABLE_MODELS,
  MODEL_FILTERS,
  AVAILABLE_ICONS,
  MODEL_HREF_MAP,
  type PageWidgetLayout,
  type WidgetConfig,
  type GridLayoutItem,
  type WidgetType,
} from "@/lib/widget-registry";

interface WidgetGridProps {
  pageType: string;
  initialLayout: PageWidgetLayout;
  /** Map of widget ID to rendered React content (for system widgets) */
  systemWidgets: Record<string, React.ReactNode>;
  /** Custom widgets from DB */
  customWidgets?: { id: string; name: string; type: string; config: string }[];
  /** Resolved stat values for stat widgets */
  statValues?: Record<string, number>;
  canEdit: boolean;
}

export function WidgetGrid({
  pageType,
  initialLayout,
  systemWidgets,
  customWidgets = [],
  statValues = {},
  canEdit,
}: WidgetGridProps) {
  const [config, setConfig] = useState<PageWidgetLayout>(initialLayout);
  const [editing, setEditing] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [templateOpen, setTemplateOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const router = useRouter();
  const { width: containerWidth, containerRef } = useContainerWidth({ initialWidth: 1200 });

  const handleLayoutChange = useCallback(
    (newLayout: readonly { i: string; x: number; y: number; w: number; h: number }[]) => {
      if (!editing) return;
      setConfig((prev) => ({ ...prev, layout: [...newLayout] as GridLayoutItem[] }));
    },
    [editing]
  );

  async function handleSave() {
    setSaving(true);
    setMessage("");
    const result = await saveWidgetLayout(pageType, config);
    if (result.success) {
      setMessage("Layout saved!");
      setEditing(false);
      router.refresh();
    } else {
      setMessage(result.error || "Failed to save");
    }
    setSaving(false);
    setTimeout(() => setMessage(""), 3000);
  }

  async function handleReset() {
    setSaving(true);
    await resetWidgetLayout(pageType);
    router.refresh();
    window.location.reload();
  }

  function removeWidget(widgetId: string) {
    setConfig((prev) => ({
      widgets: prev.widgets.filter((w) => w.id !== widgetId),
      layout: prev.layout.filter((l) => l.i !== widgetId),
    }));
  }

  function addWidget(widget: WidgetConfig) {
    const typeInfo = WIDGET_TYPE_INFO[widget.type] || WIDGET_TYPE_INFO.custom;
    const maxY = config.layout.reduce((max, l) => Math.max(max, l.y + l.h), 0);
    setConfig((prev) => ({
      widgets: [...prev.widgets, widget],
      layout: [...prev.layout, {
        i: widget.id,
        x: 0,
        y: maxY,
        ...typeInfo.defaultSize,
      }],
    }));
    setAddOpen(false);
  }

  function getWidgetTitle(widget: WidgetConfig): string {
    if (widget.title) return widget.title;
    if (widget.type === "stat" && widget.config.label) return widget.config.label as string;
    if (widget.type === "custom" && widget.customWidgetId) {
      const cw = customWidgets.find((w) => w.id === widget.customWidgetId);
      if (cw) return cw.name;
    }
    return widget.id;
  }

  function renderWidget(widget: WidgetConfig): React.ReactNode {
    // System widgets (pre-rendered server-side content)
    if (systemWidgets[widget.id]) {
      return systemWidgets[widget.id];
    }

    // Dynamic widgets
    switch (widget.type) {
      case "stat": {
        const cfg = widget.config as { label?: string; icon?: string; href?: string };
        const value = statValues[widget.id] ?? 0;
        return (
          <a href={cfg.href || "#"} className="flex items-center justify-between h-full p-5">
            <div>
              <p className="text-sm text-muted-foreground">{cfg.label || "Stat"}</p>
              <p className="text-3xl font-bold text-foreground">{value}</p>
            </div>
          </a>
        );
      }
      case "embed": {
        const cfg = widget.config as { url?: string; title?: string };
        return (
          <div className="h-full flex flex-col">
            {cfg.title && <div className="px-4 pt-3 text-sm font-semibold">{cfg.title}</div>}
            <iframe src={cfg.url} className="flex-1 w-full border-0" title={cfg.title || "Embed"} />
          </div>
        );
      }
      case "markdown": {
        const cfg = widget.config as { content?: string; title?: string };
        return (
          <div className="h-full overflow-y-auto p-5">
            {cfg.title && <h3 className="text-sm font-semibold mb-2">{cfg.title}</h3>}
            <div className="text-sm whitespace-pre-wrap text-muted-foreground">{cfg.content || ""}</div>
          </div>
        );
      }
      case "custom": {
        if (widget.customWidgetId) {
          const cw = customWidgets.find((w) => w.id === widget.customWidgetId);
          if (cw) {
            const parsed = JSON.parse(cw.config);
            return renderWidget({ ...widget, type: cw.type as WidgetType, config: parsed });
          }
        }
        return <div className="p-4 text-sm text-muted-foreground">Widget not found</div>;
      }
      default:
        return <div className="p-4 text-sm text-muted-foreground">Unknown widget type: {widget.type}</div>;
    }
  }

  return (
    <div>
      {/* Toolbar */}
      {canEdit && (
        <div className="flex items-center gap-2 mb-4 flex-wrap">
          {editing ? (
            <>
              <Button onClick={handleSave} disabled={saving} size="sm">
                <Save className="h-4 w-4 mr-1" /> Save
              </Button>
              <Button variant="outline" size="sm" onClick={() => setAddOpen(true)}>
                <Plus className="h-4 w-4 mr-1" /> Add Widget
              </Button>
              <Button variant="outline" size="sm" onClick={() => setTemplateOpen(true)}>
                <BookmarkPlus className="h-4 w-4 mr-1" /> Templates
              </Button>
              <Button variant="outline" size="sm" onClick={handleReset}>
                <RotateCcw className="h-4 w-4 mr-1" /> Reset
              </Button>
              <Button variant="ghost" size="sm" onClick={() => { setConfig(initialLayout); setEditing(false); }}>
                Cancel
              </Button>
              {message && <span className="text-sm text-success">{message}</span>}
            </>
          ) : (
            <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
              <Settings2 className="h-4 w-4 mr-1" /> Edit Layout
            </Button>
          )}
        </div>
      )}

      {/* Grid */}
      <div ref={containerRef as React.RefObject<HTMLDivElement>}>
        <ResponsiveGridLayout
          layouts={{ lg: config.layout }}
          breakpoints={{ lg: 1024, md: 768, sm: 480 }}
          cols={{ lg: 12, md: 8, sm: 4 }}
          rowHeight={50}
          width={containerWidth || 1200}
          dragConfig={{ enabled: editing, bounded: false, handle: ".drag-handle", threshold: 3 }}
          resizeConfig={{ enabled: editing }}
          onLayoutChange={(layout) => handleLayoutChange(layout)}
          compactor={verticalCompactor}
          margin={[16, 16] as [number, number]}
        >
          {config.widgets.map((widget) => {
            const layoutItem = config.layout.find((l) => l.i === widget.id);
            if (!layoutItem) return null;
            return (
              <div key={widget.id} className="relative">
                <div className={`h-full rounded border bg-card shadow-sm overflow-hidden ${editing ? "border-primary/30 ring-1 ring-primary/10" : "border-border"}`}>
                  {editing && (
                    <div className="drag-handle absolute top-0 left-0 right-0 h-7 bg-primary/5 flex items-center justify-between px-2 cursor-grab active:cursor-grabbing z-10">
                      <span className="text-[10px] font-medium text-primary/60 truncate">
                        {getWidgetTitle(widget)}
                      </span>
                      <button onClick={() => removeWidget(widget.id)} className="text-destructive/60 hover:text-destructive">
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  )}
                  <div className={editing ? "pt-7 h-full" : "h-full"}>
                    {renderWidget(widget)}
                  </div>
                </div>
              </div>
            );
          })}
        </ResponsiveGridLayout>
      </div>

      {/* Add Widget Dialog */}
      <AddWidgetDialog
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onAdd={addWidget}
        customWidgets={customWidgets}
      />

      {/* Templates Dialog */}
      <TemplateDialog
        open={templateOpen}
        onClose={() => setTemplateOpen(false)}
        currentConfig={config}
        pageType={pageType}
        onApply={(cfg) => { setConfig(cfg); setTemplateOpen(false); }}
      />
    </div>
  );
}

// ─── Add Widget Dialog ──────────────────────────────────

function AddWidgetDialog({
  open, onClose, onAdd, customWidgets,
}: {
  open: boolean;
  onClose: () => void;
  onAdd: (widget: WidgetConfig) => void;
  customWidgets: { id: string; name: string; type: string }[];
}) {
  const [tab, setTab] = useState<"builtin" | "custom">("builtin");
  const [widgetType, setWidgetType] = useState<string>("stat");
  const [model, setModel] = useState("client");
  const [filterKey, setFilterKey] = useState("all");
  const [label, setLabel] = useState("");
  const [icon, setIcon] = useState("Building2");
  const [embedUrl, setEmbedUrl] = useState("");
  const [embedTitle, setEmbedTitle] = useState("");
  const [mdContent, setMdContent] = useState("");
  const [mdTitle, setMdTitle] = useState("");

  function handleAddBuiltin() {
    const id = `${widgetType}-${Date.now()}`;
    if (widgetType === "stat") {
      const filters = MODEL_FILTERS[model] || [];
      const filterObj = filters.find((f) => f.value === filterKey)?.where || {};
      const href = MODEL_HREF_MAP[model] || "/dashboard";
      const autoLabel = label || `${filters.find((f) => f.value === filterKey)?.label || ""} ${QUERYABLE_MODELS.find((m) => m.value === model)?.label || model}`;
      onAdd({ id, type: "stat", title: autoLabel, config: { model, filter: filterObj, label: autoLabel, href, icon } });
    } else if (widgetType === "embed") {
      onAdd({ id, type: "embed", title: embedTitle || "Embed", config: { url: embedUrl, title: embedTitle } });
    } else if (widgetType === "markdown") {
      onAdd({ id, type: "markdown", title: mdTitle || "Text", config: { content: mdContent, title: mdTitle } });
    } else if (widgetType === "task-list") {
      onAdd({ id, type: "task-list", title: "My Tasks", config: { scope: "mine", limit: 8 } });
    } else if (widgetType === "activity-feed") {
      onAdd({ id, type: "activity-feed", title: "Activity", config: {} });
    } else if (widgetType === "alert-banner") {
      onAdd({ id, type: "alert-banner", title: "Alerts", config: {} });
    }
    setLabel(""); setEmbedUrl(""); setEmbedTitle(""); setMdContent(""); setMdTitle("");
  }

  function handleAddCustom(cw: { id: string; name: string }) {
    onAdd({ id: `custom-${cw.id}-${Date.now()}`, type: "custom", title: cw.name, config: {}, customWidgetId: cw.id });
  }

  const modelFilters = MODEL_FILTERS[model] || [];

  return (
    <Dialog open={open} onClose={onClose} title="Add Widget">
      <div className="space-y-4">
        {/* Tabs */}
        <div className="flex gap-2">
          <button onClick={() => setTab("builtin")} className={`px-3 py-1.5 text-sm rounded-full font-medium ${tab === "builtin" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>
            Built-in
          </button>
          {customWidgets.length > 0 && (
            <button onClick={() => setTab("custom")} className={`px-3 py-1.5 text-sm rounded-full font-medium ${tab === "custom" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>
              Custom ({customWidgets.length})
            </button>
          )}
        </div>

        {tab === "builtin" ? (
          <>
            <div>
              <label className="block text-sm font-medium mb-1">Widget Type</label>
              <div className="flex gap-2 flex-wrap">
                {Object.entries(WIDGET_TYPE_INFO).filter(([k]) => k !== "custom").map(([key, info]) => (
                  <button key={key} onClick={() => setWidgetType(key)}
                    className={`px-3 py-1.5 text-xs rounded-full font-medium transition-colors ${widgetType === key ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-border"}`}>
                    {info.label}
                  </button>
                ))}
              </div>
            </div>

            {widgetType === "stat" && (
              <>
                <Select name="model" label="Data Source" value={model} onChange={(e) => { setModel(e.target.value); setFilterKey("all"); }}
                  options={QUERYABLE_MODELS.map((m) => ({ label: m.label, value: m.value }))} />
                {modelFilters.length > 0 && (
                  <Select name="filter" label="Filter" value={filterKey} onChange={(e) => setFilterKey(e.target.value)}
                    options={modelFilters.map((f) => ({ label: f.label, value: f.value }))} />
                )}
                <Input name="label" label="Label (optional)" value={label} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setLabel(e.target.value)} placeholder="Auto-generated if empty" />
                <Select name="icon" label="Icon" value={icon} onChange={(e) => setIcon(e.target.value)}
                  options={AVAILABLE_ICONS.map((i) => ({ label: i, value: i }))} />
              </>
            )}
            {widgetType === "embed" && (
              <>
                <Input name="embedUrl" label="URL" value={embedUrl} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEmbedUrl(e.target.value)} placeholder="https://..." />
                <Input name="embedTitle" label="Title" value={embedTitle} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEmbedTitle(e.target.value)} />
              </>
            )}
            {widgetType === "markdown" && (
              <>
                <Input name="mdTitle" label="Title" value={mdTitle} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setMdTitle(e.target.value)} />
                <Textarea name="mdContent" label="Content" value={mdContent} onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setMdContent(e.target.value)} rows={5} />
              </>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={onClose}>Cancel</Button>
              <Button onClick={handleAddBuiltin}>Add Widget</Button>
            </div>
          </>
        ) : (
          <div className="space-y-2">
            {customWidgets.map((cw) => (
              <div key={cw.id} className="flex items-center justify-between rounded border border-border p-3">
                <div>
                  <p className="text-sm font-medium">{cw.name}</p>
                  <p className="text-xs text-muted-foreground">{cw.type}</p>
                </div>
                <Button size="sm" onClick={() => handleAddCustom(cw)}>Add</Button>
              </div>
            ))}
            <div className="flex justify-end pt-2">
              <Button variant="outline" onClick={onClose}>Close</Button>
            </div>
          </div>
        )}
      </div>
    </Dialog>
  );
}

// ─── Template Dialog ────────────────────────────────────

function TemplateDialog({
  open, onClose, currentConfig, pageType, onApply,
}: {
  open: boolean;
  onClose: () => void;
  currentConfig: PageWidgetLayout;
  pageType: string;
  onApply: (config: PageWidgetLayout) => void;
}) {
  const [templates, setTemplates] = useState<WidgetTemplate[]>([]);
  const [newName, setNewName] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);

  async function load() {
    if (loaded) return;
    const tpls = await getWidgetTemplates();
    setTemplates(tpls);
    setLoaded(true);
  }
  if (open && !loaded) load();

  async function handleSave() {
    if (!newName.trim()) return;
    setSaving(true);
    await saveWidgetTemplate(newName.trim(), pageType, currentConfig);
    const tpls = await getWidgetTemplates();
    setTemplates(tpls);
    setNewName("");
    setSaving(false);
  }

  async function handleDelete(id: string) {
    await deleteWidgetTemplate(id);
    setTemplates((prev) => prev.filter((t) => t.id !== id));
  }

  return (
    <Dialog open={open} onClose={onClose} title="Layout Templates">
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium mb-1">Save current as template</label>
          <div className="flex gap-2">
            <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Template name..."
              className="flex-1 h-9 rounded border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-primary" />
            <Button size="sm" onClick={handleSave} disabled={saving || !newName.trim()}>Save</Button>
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium mb-2">Saved Templates</label>
          {templates.length === 0 ? (
            <p className="text-sm text-muted-foreground">No templates yet</p>
          ) : (
            <div className="space-y-2">
              {templates.map((tpl) => (
                <div key={tpl.id} className="flex items-center justify-between rounded border border-border p-3">
                  <div>
                    <p className="text-sm font-medium">{tpl.name}</p>
                    <p className="text-xs text-muted-foreground">{tpl.pageType} · {tpl.config.widgets.length} widgets</p>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button size="sm" variant="outline" onClick={() => onApply(tpl.config)}>Apply</Button>
                    <Button size="sm" variant="ghost" className="text-destructive" onClick={() => handleDelete(tpl.id)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="flex justify-end pt-2">
          <Button variant="outline" onClick={onClose}>Close</Button>
        </div>
      </div>
    </Dialog>
  );
}
