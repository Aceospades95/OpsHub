"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Avatar } from "@/components/ui/avatar";
import {
  Settings2, Plus, Save, RotateCcw, X, Trash2,
  Building2, FolderKanban, FileText, CheckSquare, Truck, Users, Wrench,
  Globe, AlertTriangle, TrendingUp, DollarSign, Clock, Star, Target,
  BarChart3, PieChart, Activity, Shield, Zap, BookmarkPlus,
  type LucideIcon,
} from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import {
  saveDashboardLayout,
  resetDashboardLayout,
  saveTemplate,
  getTemplates,
  deleteTemplate,
} from "@/actions/dashboard-layout";
import {
  QUERYABLE_MODELS,
  MODEL_FILTERS,
  AVAILABLE_ICONS,
  MODEL_HREF_MAP,
  type DashboardLayoutConfig,
  type DashboardWidget,
  type GridItem,
  type StatWidgetConfig,
  type TaskListConfig,
  type LayoutTemplate,
} from "@/lib/dashboard-widgets";
import { DashboardTaskCheckbox } from "./dashboard-task-checkbox";
import Link from "next/link";

import { ResponsiveGridLayout, useContainerWidth, verticalCompactor } from "react-grid-layout";

const ICON_MAP: Record<string, LucideIcon> = {
  Building2, FolderKanban, FileText, CheckSquare, Truck, Users, Wrench,
  Globe, AlertTriangle, TrendingUp, DollarSign, Clock, Star, Target,
  BarChart3, PieChart, Activity, Shield, Zap,
};

interface DashboardGridProps {
  config: DashboardLayoutConfig;
  statValues: Record<string, number>;
  tasks: TaskData[];
  activityLogs: ActivityData[];
  alertData: { expiringContracts: number };
  canEdit: boolean;
  userId: string;
}

interface TaskData {
  id: string;
  title: string;
  status: string;
  priority: string;
  dueDate: string | null;
  project: { id: string; name: string } | null;
  client: { id: string; name: string } | null;
  assignee: { name: string } | null;
}

interface ActivityData {
  id: string;
  action: string;
  entityType: string;
  details: string | null;
  createdAt: string;
  user: { name: string };
}

const priorityColors: Record<string, string> = {
  HIGH: "bg-red-100 text-red-800",
  MEDIUM: "bg-yellow-100 text-yellow-800",
  LOW: "bg-green-100 text-green-800",
};

export function DashboardGrid({
  config: initialConfig,
  statValues: initialStats,
  tasks,
  activityLogs,
  alertData,
  canEdit,
  userId,
}: DashboardGridProps) {
  const [config, setConfig] = useState<DashboardLayoutConfig>(initialConfig);
  const [editing, setEditing] = useState(false);
  const [statValues, setStatValues] = useState(initialStats);
  const [addWidgetOpen, setAddWidgetOpen] = useState(false);
  const [templateOpen, setTemplateOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const router = useRouter();

  const { width: containerWidth, containerRef } = useContainerWidth({ initialWidth: 1200 });

  const handleLayoutChange = useCallback(
    (newLayout: GridItem[]) => {
      if (!editing) return;
      setConfig((prev) => ({ ...prev, layout: newLayout }));
    },
    [editing]
  );

  async function handleSave() {
    setSaving(true);
    const result = await saveDashboardLayout(config);
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
    await resetDashboardLayout();
    router.refresh();
    window.location.reload();
  }

  function removeWidget(widgetId: string) {
    setConfig((prev) => ({
      widgets: prev.widgets.filter((w) => w.id !== widgetId),
      layout: prev.layout.filter((l) => l.i !== widgetId),
    }));
  }

  function addWidget(widget: DashboardWidget) {
    const maxY = config.layout.reduce((max, l) => Math.max(max, l.y + l.h), 0);
    const newLayoutItem: GridItem = {
      i: widget.id,
      x: 0,
      y: maxY,
      w: widget.type === "stat" ? 3 : 6,
      h: widget.type === "stat" ? 2 : 5,
      minW: widget.type === "stat" ? 2 : 3,
      minH: widget.type === "stat" ? 2 : 3,
    };
    setConfig((prev) => ({
      widgets: [...prev.widgets, widget],
      layout: [...prev.layout, newLayoutItem],
    }));
    setAddWidgetOpen(false);
  }

  function renderWidget(widget: DashboardWidget) {
    switch (widget.type) {
      case "stat":
        return <StatWidget config={widget.config as StatWidgetConfig} value={statValues[widget.id] ?? 0} />;
      case "task-list":
        return <TaskListWidget tasks={tasks} userId={userId} />;
      case "activity-feed":
        return <ActivityFeedWidget logs={activityLogs} />;
      case "alert-banner":
        return <AlertWidget data={alertData} />;
      default:
        return <div className="p-4 text-sm text-muted-foreground">Unknown widget</div>;
    }
  }

  return (
    <div>
      {/* Toolbar */}
      {canEdit && (
        <div className="flex items-center gap-2 mb-4">
          {editing ? (
            <>
              <Button onClick={handleSave} disabled={saving} size="sm">
                <Save className="h-4 w-4 mr-1" /> Save
              </Button>
              <Button variant="outline" size="sm" onClick={() => setAddWidgetOpen(true)}>
                <Plus className="h-4 w-4 mr-1" /> Add Widget
              </Button>
              <Button variant="outline" size="sm" onClick={() => setTemplateOpen(true)}>
                <BookmarkPlus className="h-4 w-4 mr-1" /> Templates
              </Button>
              <Button variant="outline" size="sm" onClick={handleReset}>
                <RotateCcw className="h-4 w-4 mr-1" /> Reset
              </Button>
              <Button variant="ghost" size="sm" onClick={() => { setConfig(initialConfig); setEditing(false); }}>
                Cancel
              </Button>
              {message && <span className="text-sm text-success ml-2">{message}</span>}
            </>
          ) : (
            <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
              <Settings2 className="h-4 w-4 mr-1" /> Edit Dashboard
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
        onLayoutChange={(layout) => handleLayoutChange([...layout] as GridItem[])}
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
                      {widget.type === "stat" ? (widget.config as StatWidgetConfig).label : widget.type.replace("-", " ")}
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
        open={addWidgetOpen}
        onClose={() => setAddWidgetOpen(false)}
        onAdd={addWidget}
        existingIds={config.widgets.map((w) => w.id)}
      />

      {/* Templates Dialog */}
      <TemplateDialog
        open={templateOpen}
        onClose={() => setTemplateOpen(false)}
        currentConfig={config}
        onApply={(cfg) => { setConfig(cfg); setTemplateOpen(false); }}
      />
    </div>
  );
}

// ─── Stat Widget ────────────────────────────────────────

function StatWidget({ config, value }: { config: StatWidgetConfig; value: number }) {
  const Icon = ICON_MAP[config.icon] || Activity;
  return (
    <Link href={config.href} className="block h-full">
      <div className="flex items-center justify-between h-full p-5">
        <div>
          <p className="text-sm text-muted-foreground">{config.label}</p>
          <p className="text-3xl font-bold text-foreground">{value}</p>
          {config.subLabel && <p className="text-xs text-muted-foreground mt-1">{config.subLabel}</p>}
        </div>
        <Icon className="h-8 w-8 text-primary/60 shrink-0" />
      </div>
    </Link>
  );
}

// ─── Task List Widget ───────────────────────────────────

function TaskListWidget({ tasks, userId }: { tasks: TaskData[]; userId: string }) {
  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between px-5 pt-4 pb-2">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <CheckSquare className="h-4 w-4" /> My Tasks
        </h3>
        <Link href="/tasks?assignee=me" className="text-xs text-primary hover:underline">View all</Link>
      </div>
      <div className="flex-1 overflow-y-auto px-5 pb-4">
        {tasks.length === 0 ? (
          <p className="text-sm text-muted-foreground py-2">No open tasks</p>
        ) : (
          <div className="space-y-2">
            {tasks.map((task) => (
              <div key={task.id} className="flex items-center gap-3 py-1">
                <DashboardTaskCheckbox taskId={task.id} status={task.status} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium truncate">{task.title}</span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${priorityColors[task.priority]}`}>{task.priority}</span>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    {task.project && <span>{task.project.name}</span>}
                    {task.dueDate && (
                      <span className={new Date(task.dueDate) < new Date() ? "text-destructive" : ""}>
                        {format(new Date(task.dueDate), "MMM d")}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Activity Feed Widget ───────────────────────────────

function ActivityFeedWidget({ logs }: { logs: ActivityData[] }) {
  return (
    <div className="h-full flex flex-col">
      <div className="px-5 pt-4 pb-2">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <Activity className="h-4 w-4" /> Recent Activity
        </h3>
      </div>
      <div className="flex-1 overflow-y-auto px-5 pb-4">
        {logs.length === 0 ? (
          <p className="text-sm text-muted-foreground">No recent activity</p>
        ) : (
          <div className="space-y-3">
            {logs.map((log) => (
              <div key={log.id} className="flex items-start gap-3">
                <Avatar name={log.user.name} size="xs" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm">
                    <span className="font-medium">{log.user.name}</span>{" "}
                    <span className="text-muted-foreground">{log.action} {log.entityType}</span>
                    {log.details && <span className="text-muted-foreground"> — {log.details}</span>}
                  </p>
                  <p className="text-xs text-muted-foreground">{formatDistanceToNow(log.createdAt, { addSuffix: true })}</p>
                </div>
                <Badge variant="outline" className="shrink-0 text-[10px]">{log.action}</Badge>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Alert Widget ───────────────────────────────────────

function AlertWidget({ data }: { data: { expiringContracts: number } }) {
  if (data.expiringContracts === 0) {
    return <div className="flex items-center gap-3 h-full px-5"><span className="text-sm text-muted-foreground">No active alerts</span></div>;
  }
  return (
    <div className="flex items-center gap-3 h-full px-5">
      <AlertTriangle className="h-5 w-5 text-warning shrink-0" />
      <p className="text-sm">
        <strong>{data.expiringContracts}</strong> contract{data.expiringContracts !== 1 ? "s" : ""} expiring soon or expired.{" "}
        <Link href="/contracts" className="text-primary hover:underline">Review now</Link>
      </p>
    </div>
  );
}

// ─── Add Widget Dialog ──────────────────────────────────

function AddWidgetDialog({
  open, onClose, onAdd, existingIds,
}: {
  open: boolean;
  onClose: () => void;
  onAdd: (widget: DashboardWidget) => void;
  existingIds: string[];
}) {
  const [widgetType, setWidgetType] = useState<string>("stat");
  const [model, setModel] = useState("client");
  const [filterKey, setFilterKey] = useState("all");
  const [label, setLabel] = useState("");
  const [icon, setIcon] = useState("Building2");

  function handleAdd() {
    if (widgetType === "stat") {
      const filters = MODEL_FILTERS[model] || [];
      const filterObj = filters.find((f) => f.value === filterKey)?.where || {};
      const id = `stat-${model}-${filterKey}-${Date.now()}`;
      const href = MODEL_HREF_MAP[model] || "/dashboard";
      onAdd({
        id,
        type: "stat",
        config: {
          model,
          filter: filterObj,
          label: label || `${filters.find((f) => f.value === filterKey)?.label || ""} ${QUERYABLE_MODELS.find((m) => m.value === model)?.label || model}`,
          href,
          icon,
        } as StatWidgetConfig,
      });
    } else {
      const id = `${widgetType}-${Date.now()}`;
      const config = widgetType === "task-list" ? { scope: "mine", limit: 8 } : {};
      onAdd({ id, type: widgetType as DashboardWidget["type"], config });
    }
    // Reset form
    setLabel("");
    setFilterKey("all");
  }

  const modelFilters = MODEL_FILTERS[model] || [];

  return (
    <Dialog open={open} onClose={onClose} title="Add Widget">
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium mb-1">Widget Type</label>
          <div className="flex gap-2 flex-wrap">
            {[
              { value: "stat", label: "Stat Counter" },
              { value: "task-list", label: "Task List" },
              { value: "activity-feed", label: "Activity Feed" },
              { value: "alert-banner", label: "Alert Banner" },
            ].map((t) => (
              <button
                key={t.value}
                onClick={() => setWidgetType(t.value)}
                className={`px-3 py-1.5 text-sm rounded-full font-medium transition-colors ${
                  widgetType === t.value ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-border"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {widgetType === "stat" && (
          <>
            <Select
              name="model"
              label="Data Source"
              value={model}
              onChange={(e) => { setModel(e.target.value); setFilterKey("all"); }}
              options={QUERYABLE_MODELS.map((m) => ({ label: m.label, value: m.value }))}
            />
            {modelFilters.length > 0 && (
              <Select
                name="filter"
                label="Filter"
                value={filterKey}
                onChange={(e) => setFilterKey(e.target.value)}
                options={modelFilters.map((f) => ({ label: f.label, value: f.value }))}
              />
            )}
            <Input
              name="label"
              label="Label (optional)"
              value={label}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setLabel(e.target.value)}
              placeholder="Auto-generated if empty"
            />
            <Select
              name="icon"
              label="Icon"
              value={icon}
              onChange={(e) => setIcon(e.target.value)}
              options={AVAILABLE_ICONS.map((i) => ({ label: i, value: i }))}
            />
          </>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleAdd}>Add Widget</Button>
        </div>
      </div>
    </Dialog>
  );
}

// ─── Template Dialog ────────────────────────────────────

function TemplateDialog({
  open, onClose, currentConfig, onApply,
}: {
  open: boolean;
  onClose: () => void;
  currentConfig: DashboardLayoutConfig;
  onApply: (config: DashboardLayoutConfig) => void;
}) {
  const [templates, setTemplates] = useState<LayoutTemplate[]>([]);
  const [newName, setNewName] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);

  async function load() {
    if (loaded) return;
    const tpls = await getTemplates();
    setTemplates(tpls);
    setLoaded(true);
  }

  if (open && !loaded) load();

  async function handleSaveTemplate() {
    if (!newName.trim()) return;
    setSaving(true);
    await saveTemplate(newName.trim(), "dashboard", currentConfig);
    const tpls = await getTemplates();
    setTemplates(tpls);
    setNewName("");
    setSaving(false);
  }

  async function handleApply(tpl: LayoutTemplate) {
    onApply(tpl.config);
  }

  async function handleDelete(id: string) {
    await deleteTemplate(id);
    setTemplates((prev) => prev.filter((t) => t.id !== id));
  }

  return (
    <Dialog open={open} onClose={onClose} title="Layout Templates">
      <div className="space-y-4">
        {/* Save current as template */}
        <div>
          <label className="block text-sm font-medium mb-1">Save current layout as template</label>
          <div className="flex gap-2">
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Template name..."
              className="flex-1 h-9 rounded border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-primary"
            />
            <Button size="sm" onClick={handleSaveTemplate} disabled={saving || !newName.trim()}>
              Save
            </Button>
          </div>
        </div>

        {/* Existing templates */}
        <div>
          <label className="block text-sm font-medium mb-2">Saved Templates</label>
          {templates.length === 0 ? (
            <p className="text-sm text-muted-foreground">No templates saved yet</p>
          ) : (
            <div className="space-y-2">
              {templates.map((tpl) => (
                <div key={tpl.id} className="flex items-center justify-between rounded border border-border p-3">
                  <div>
                    <p className="text-sm font-medium">{tpl.name}</p>
                    <p className="text-xs text-muted-foreground">{tpl.config.widgets.length} widgets</p>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button size="sm" variant="outline" onClick={() => handleApply(tpl)}>Apply</Button>
                    <Button size="sm" variant="ghost" className="text-destructive" onClick={() => handleDelete(tpl.id)}>
                      <Trash2 className="h-3.5 w-3.5" />
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
