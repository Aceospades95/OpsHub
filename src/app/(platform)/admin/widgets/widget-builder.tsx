"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Save, Trash2, Plus, RefreshCw } from "lucide-react";
import { createCustomWidget, updateCustomWidget, previewCustomWidget } from "@/actions/custom-widgets";
import { DATA_SOURCES } from "@/lib/widget-builder/data-source-registry";
import type { WidgetConfig, FilterConfig, DisplayType, AggregationType } from "@/lib/widget-builder/widget-config-types";
import type { DataSourceField, DisplayProps } from "@/lib/widget-builder/widget-config-types";
// Display components for preview
import { DisplayStatCard } from "@/components/widgets/custom/display-stat-card";
import { DisplayCounterRow } from "@/components/widgets/custom/display-counter-row";
import { DisplayList } from "@/components/widgets/custom/display-list";
import { DisplayTable } from "@/components/widgets/custom/display-table";
import { DisplayProgressBar } from "@/components/widgets/custom/display-progress-bar";
import { DisplayBarChart } from "@/components/widgets/custom/display-bar-chart";
import { DisplayStatusBoard } from "@/components/widgets/custom/display-status-board";

const DISPLAY_MAP: Record<DisplayType, React.ComponentType<DisplayProps>> = {
  "stat-card": DisplayStatCard,
  "counter-row": DisplayCounterRow,
  list: DisplayList,
  table: DisplayTable,
  "progress-bar": DisplayProgressBar,
  "bar-chart": DisplayBarChart,
  "status-board": DisplayStatusBoard,
};

const DISPLAY_TYPES: { value: DisplayType; label: string; description: string }[] = [
  { value: "stat-card", label: "Stat Card", description: "Single big number" },
  { value: "counter-row", label: "Counter Row", description: "Grouped counts in a row" },
  { value: "list", label: "List", description: "Vertical list of items" },
  { value: "table", label: "Table", description: "Full table with columns" },
  { value: "progress-bar", label: "Progress Bar", description: "Progress toward a goal" },
  { value: "bar-chart", label: "Bar Chart", description: "Horizontal bars" },
  { value: "status-board", label: "Status Board", description: "Grouped by status" },
];

const CATEGORIES = [
  { value: "analytics", label: "Analytics & Metrics" },
  { value: "communication", label: "Communication" },
  { value: "productivity", label: "Productivity" },
  { value: "content", label: "Content & Media" },
  { value: "data", label: "Data & Lists" },
  { value: "status", label: "Status & Monitoring" },
];

const OPERATORS = [
  { value: "equals", label: "equals" },
  { value: "contains", label: "contains" },
  { value: "gt", label: ">" },
  { value: "gte", label: ">=" },
  { value: "lt", label: "<" },
  { value: "lte", label: "<=" },
  { value: "in", label: "in" },
  { value: "notIn", label: "not in" },
  { value: "isNull", label: "is empty" },
  { value: "isNotNull", label: "is not empty" },
];

/**
 * Coerce raw form values to the types the data-source executor feeds
 * Prisma. The inputs keep plain strings while typing; without this a
 * saved `value > "10000"` (string) or `isActive equals "true"` (string)
 * hits Prisma as the wrong type and the widget errors at render time.
 * "in"/"notIn" become real arrays — the executor wraps non-arrays as a
 * single-element list, so a raw "A,B" string would match nothing.
 */
function normalizeConfigForPersist(config: WidgetConfig): WidgetConfig {
  const fields = DATA_SOURCES[config.dataSourceId]?.fields || [];
  const byKey = new Map(fields.map((f) => [f.key, f]));

  // Keep aggregation coherent with the display type so what the preview
  // shows is exactly what a saved dashboard renders:
  //   stat-card / progress-bar → a scalar aggregation (never countByField)
  //   counter-row / bar-chart  → always countByField over the group field
  //   list / table / status-board → row mode (no aggregation)
  let aggregation = config.aggregation;
  if (["stat-card", "progress-bar"].includes(config.displayType)) {
    if (!aggregation || aggregation.type === "countByField") {
      aggregation = { type: "count" };
    }
  } else if (["counter-row", "bar-chart"].includes(config.displayType)) {
    aggregation = {
      type: "countByField",
      groupByField: config.groupByField || aggregation?.groupByField,
    };
  } else {
    aggregation = undefined;
  }

  const filters: FilterConfig[] = [];
  for (const f of config.filters) {
    if (f.operator === "isNull" || f.operator === "isNotNull") {
      filters.push(f);
      continue;
    }
    if (f.operator === "in" || f.operator === "notIn") {
      const list = Array.isArray(f.value)
        ? f.value.map(String).filter(Boolean)
        : String(f.value ?? "")
            .split(/[,;]+/)
            .map((s) => s.trim())
            .filter(Boolean);
      // No values picked yet ⇒ no filter (an empty `in` list would
      // match nothing / everything).
      if (list.length > 0) filters.push({ ...f, value: list });
      continue;
    }
    const raw = String(f.value ?? "").trim();
    // An empty value means "not configured" — drop the clause rather
    // than coercing it into `equals ""` / `equals 0` / `equals false`.
    if (raw === "") continue;
    const def = byKey.get(f.field);
    if (def?.type === "number") {
      const n = Number(raw);
      if (Number.isFinite(n)) filters.push({ ...f, value: n });
      continue;
    }
    if (def?.type === "boolean") {
      filters.push({ ...f, value: raw === "true" });
      continue;
    }
    if (def?.type === "date") {
      const d = new Date(raw);
      if (!isNaN(d.getTime())) filters.push({ ...f, value: d.toISOString() });
      continue;
    }
    filters.push(f);
  }

  return { ...config, aggregation, filters };
}

interface WidgetBuilderProps {
  widgetId?: string;
  initialName?: string;
  initialDescription?: string;
  initialConfig?: WidgetConfig;
  initialIcon?: string;
  initialCategory?: string;
  initialIsPublished?: boolean;
}

function defaultConfig(): WidgetConfig {
  return {
    dataSourceId: "client",
    filters: [],
    sort: { field: "name", direction: "asc" },
    limit: 10,
    displayType: "list",
    title: "My Widget",
    showHeader: true,
  };
}

export function WidgetBuilder({
  widgetId,
  initialName = "",
  initialDescription = "",
  initialConfig,
  initialIcon = "BarChart3",
  initialCategory = "data",
  initialIsPublished = false,
}: WidgetBuilderProps) {
  const router = useRouter();
  const [name, setName] = useState(initialName);
  const [description, setDescription] = useState(initialDescription);
  const [icon, setIcon] = useState(initialIcon);
  const [category, setCategory] = useState(initialCategory);
  const [isPublished, setIsPublished] = useState(initialIsPublished);
  const [config, setConfig] = useState<WidgetConfig>(initialConfig || defaultConfig());
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // Preview state
  const [previewData, setPreviewData] = useState<{ rows: Record<string, unknown>[]; aggregate?: number | Record<string, number> } | null>(null);
  const [previewFields, setPreviewFields] = useState<DataSourceField[]>([]);
  const [previewing, setPreviewing] = useState(false);

  const ds = DATA_SOURCES[config.dataSourceId];
  const fields = ds?.fields || [];
  // Relation fields ("Client", "Assignee"…) are display-only: the
  // executor allowlists scalar columns for filtering/sorting/grouping
  // and silently drops anything else. Offering them in those pickers
  // made controls that looked set but did nothing.
  const scalarFields = fields.filter((f) => !f.relation);

  const updateConfig = useCallback((partial: Partial<WidgetConfig>) => {
    setConfig((prev) => ({ ...prev, ...partial }));
  }, []);

  async function handlePreview() {
    setPreviewing(true);
    setMessage(null);
    try {
      const result = await previewCustomWidget(
        JSON.stringify(normalizeConfigForPersist(config))
      );
      if ("data" in result && result.data) {
        setPreviewData(result.data);
        setPreviewFields(result.fields || []);
      } else {
        setMessage({ type: "error", text: result.error || "Preview failed" });
      }
    } catch {
      setMessage({ type: "error", text: "Preview failed. Check the filter values and try again." });
    } finally {
      setPreviewing(false);
    }
  }

  async function handleSave() {
    if (!name.trim()) { setMessage({ type: "error", text: "Name is required" }); return; }
    setSaving(true);
    setMessage(null);

    const payload = {
      name: name.trim(),
      description: description.trim() || undefined,
      config: JSON.stringify(normalizeConfigForPersist(config)),
      icon,
      category,
      isPublished,
    };

    try {
      const result = widgetId
        ? await updateCustomWidget(widgetId, payload)
        : await createCustomWidget(payload);

      if ("error" in result) {
        setMessage({ type: "error", text: result.error || "Failed to save" });
      } else {
        setMessage({ type: "success", text: "Saved!" });
        if (!widgetId && "id" in result) {
          router.push(`/admin/widgets/${result.id}`);
        } else {
          router.refresh();
        }
      }
    } catch {
      setMessage({ type: "error", text: "Failed to save. Try again." });
    }
    setSaving(false);
    setTimeout(() => setMessage(null), 3000);
  }

  function addFilter() {
    const firstField = scalarFields[0]?.key || "name";
    updateConfig({
      filters: [...config.filters, { field: firstField, operator: "equals", value: "" }],
    });
  }

  function updateFilter(i: number, partial: Partial<FilterConfig>) {
    const updated = [...config.filters];
    updated[i] = { ...updated[i], ...partial };
    updateConfig({ filters: updated });
  }

  function removeFilter(i: number) {
    updateConfig({ filters: config.filters.filter((_, idx) => idx !== i) });
  }

  function handleDataSourceChange(newId: string) {
    const newDs = DATA_SOURCES[newId];
    if (!newDs) return;
    // Rebuild the aggregation for the new source — keeping the old one
    // carried a stale field/groupByField from the previous source's
    // schema, which the executor drops (widget rendered "No data").
    let aggregation: WidgetConfig["aggregation"];
    let groupByField: string | undefined;
    if (["stat-card", "progress-bar"].includes(config.displayType)) {
      aggregation = { type: "count" };
    } else if (["counter-row", "bar-chart"].includes(config.displayType)) {
      const enumField = newDs.fields.find((f) => f.type === "enum" && !f.relation);
      aggregation = { type: "countByField", groupByField: enumField?.key };
      groupByField = enumField?.key;
    }
    updateConfig({
      dataSourceId: newId,
      filters: [],
      sort: newDs.defaultSort,
      columns: undefined,
      labelField: undefined,
      valueField: undefined,
      groupByField,
      aggregation,
    });
    setPreviewData(null);
  }

  // Only the single-number displays expose an aggregation picker.
  // Counter Row / Bar Chart always use countByField (set when the
  // display type is picked) — offering "count"/"sum" there produced a
  // scalar the grouped displays can't render ("No data").
  const needsAggregation = ["stat-card", "progress-bar"].includes(config.displayType);
  const needsGroupBy = ["counter-row", "bar-chart", "status-board"].includes(config.displayType);
  const needsColumns = ["list", "table"].includes(config.displayType);
  // Scalar aggregations for stat-card / progress-bar. countByField is
  // excluded — it returns a per-group object those displays render as 0.
  const scalarAggregations = (ds?.aggregations || ["count"]).filter(
    (a) => a !== "countByField"
  );
  const numericFields = scalarFields.filter((f) => f.type === "number");

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      {/* Left: Config */}
      <div className="space-y-6">
        {/* Basic info */}
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-sm">Basic Info</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground">Name *</label>
              <input type="text" value={name} onChange={(e) => setName(e.target.value)}
                className="w-full mt-1 px-3 py-2 text-sm border border-input rounded-md bg-background" placeholder="Widget name" />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Description</label>
              <input type="text" value={description} onChange={(e) => setDescription(e.target.value)}
                className="w-full mt-1 px-3 py-2 text-sm border border-input rounded-md bg-background" placeholder="Optional description" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground">Category</label>
                <select value={category} onChange={(e) => setCategory(e.target.value)}
                  className="w-full mt-1 px-3 py-2 text-sm border border-input rounded-md bg-background">
                  {CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Title</label>
                <input type="text" value={config.title} onChange={(e) => updateConfig({ title: e.target.value })}
                  className="w-full mt-1 px-3 py-2 text-sm border border-input rounded-md bg-background" />
              </div>
            </div>
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={isPublished} onChange={(e) => setIsPublished(e.target.checked)} className="accent-primary" />
                Published (visible in Add Widget catalog)
              </label>
            </div>
          </CardContent>
        </Card>

        {/* Data Source */}
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-sm">Data Source</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground">Source</label>
              <select value={config.dataSourceId} onChange={(e) => handleDataSourceChange(e.target.value)}
                className="w-full mt-1 px-3 py-2 text-sm border border-input rounded-md bg-background">
                {Object.values(DATA_SOURCES).map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
              </select>
            </div>

            {/* Filters */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs font-medium text-muted-foreground">Filters</label>
                <button onClick={addFilter} className="text-xs text-primary hover:underline flex items-center gap-1">
                  <Plus className="h-3 w-3" /> Add Filter
                </button>
              </div>
              {config.filters.map((filter, i) => (
                <div key={i} className="flex items-center gap-2 mt-1 flex-wrap sm:flex-nowrap">
                  <select value={filter.field}
                    onChange={(e) => updateFilter(i, { field: e.target.value, value: "" })}
                    className="flex-1 min-w-[8rem] px-2 py-1 text-sm border border-input rounded bg-background">
                    {scalarFields.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
                  </select>
                  <select value={filter.operator}
                    onChange={(e) => {
                      const op = e.target.value as FilterConfig["operator"];
                      // List ops store arrays, scalar ops store scalars —
                      // reset the value when crossing that boundary so a
                      // stale shape can't linger in the config.
                      const wasList = filter.operator === "in" || filter.operator === "notIn";
                      const isList = op === "in" || op === "notIn";
                      updateFilter(i, wasList !== isList ? { operator: op, value: "" } : { operator: op });
                    }}
                    className="w-28 px-2 py-1 text-sm border border-input rounded bg-background">
                    {OPERATORS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                  {filter.operator !== "isNull" && filter.operator !== "isNotNull" && (
                    (() => {
                      const fieldDef = fields.find((f) => f.key === filter.field);
                      const isListOp = filter.operator === "in" || filter.operator === "notIn";
                      if (fieldDef?.type === "enum" && fieldDef.enumValues) {
                        if (isListOp) {
                          // Multi-value chips — a single select can't
                          // express "status in [A, B]".
                          const selected = Array.isArray(filter.value)
                            ? filter.value.map(String)
                            : String(filter.value ?? "").split(",").map((s) => s.trim()).filter(Boolean);
                          return (
                            <div className="flex flex-1 flex-wrap gap-1">
                              {fieldDef.enumValues.map((v) => {
                                const active = selected.includes(v);
                                return (
                                  <button key={v} type="button" aria-pressed={active}
                                    onClick={() => updateFilter(i, {
                                      value: active ? selected.filter((x) => x !== v) : [...selected, v],
                                    })}
                                    className={`px-2 py-0.5 text-xs rounded-full border transition-colors ${
                                      active
                                        ? "border-primary bg-primary/10 text-primary"
                                        : "border-border text-muted-foreground hover:border-primary/30"
                                    }`}>
                                    {v}
                                  </button>
                                );
                              })}
                            </div>
                          );
                        }
                        return (
                          <select value={String(filter.value)} onChange={(e) => updateFilter(i, { value: e.target.value })}
                            className="flex-1 px-2 py-1 text-sm border border-input rounded bg-background">
                            <option value="">Select...</option>
                            {fieldDef.enumValues.map((v) => <option key={v} value={v}>{v}</option>)}
                          </select>
                        );
                      }
                      if (fieldDef?.type === "boolean" && !isListOp) {
                        return (
                          <select value={String(filter.value)} onChange={(e) => updateFilter(i, { value: e.target.value })}
                            className="flex-1 px-2 py-1 text-sm border border-input rounded bg-background">
                            <option value="">Select...</option>
                            <option value="true">true</option>
                            <option value="false">false</option>
                          </select>
                        );
                      }
                      if (fieldDef?.type === "date" && !isListOp) {
                        return (
                          <input type="date" value={String(filter.value)} onChange={(e) => updateFilter(i, { value: e.target.value })}
                            className="flex-1 px-2 py-1 text-sm border border-input rounded bg-background" />
                        );
                      }
                      if (fieldDef?.type === "number" && !isListOp) {
                        return (
                          <input type="number" value={String(filter.value)} onChange={(e) => updateFilter(i, { value: e.target.value })}
                            className="flex-1 px-2 py-1 text-sm border border-input rounded bg-background" placeholder="Value" />
                        );
                      }
                      return (
                        <input type="text"
                          value={Array.isArray(filter.value) ? filter.value.join(", ") : String(filter.value)}
                          onChange={(e) => updateFilter(i, { value: e.target.value })}
                          className="flex-1 px-2 py-1 text-sm border border-input rounded bg-background"
                          placeholder={isListOp ? "Comma-separated values" : "Value"} />
                      );
                    })()
                  )}
                  <button onClick={() => removeFilter(i)} className="text-destructive hover:text-destructive/80 p-1" aria-label="Remove filter">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>

            {/* Sort & Limit */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <div>
                <label className="text-xs font-medium text-muted-foreground">Sort By</label>
                <select value={config.sort.field} onChange={(e) => updateConfig({ sort: { ...config.sort, field: e.target.value } })}
                  className="w-full mt-1 px-2 py-1 text-sm border border-input rounded bg-background">
                  {scalarFields.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
                  {/* Saved configs may still point at a relation field —
                      surface it (the executor falls back to the default
                      sort) instead of letting the select silently show
                      the first option. */}
                  {!scalarFields.some((f) => f.key === config.sort.field) && (
                    <option value={config.sort.field}>
                      {config.sort.field} (unsupported — uses default)
                    </option>
                  )}
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Direction</label>
                <select value={config.sort.direction} onChange={(e) => updateConfig({ sort: { ...config.sort, direction: e.target.value as "asc" | "desc" } })}
                  className="w-full mt-1 px-2 py-1 text-sm border border-input rounded bg-background">
                  <option value="asc">Ascending</option>
                  <option value="desc">Descending</option>
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Limit</label>
                <input type="number" min={1} max={100} value={config.limit} onChange={(e) => updateConfig({ limit: Number(e.target.value) || 10 })}
                  className="w-full mt-1 px-2 py-1 text-sm border border-input rounded bg-background" />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Display */}
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-sm">Display Type</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              {DISPLAY_TYPES.map((dt) => (
                <button key={dt.value}
                  onClick={() => {
                    const updates: Partial<WidgetConfig> = { displayType: dt.value };
                    if (["stat-card", "progress-bar"].includes(dt.value)) {
                      updates.aggregation = { type: "count" };
                    } else if (["counter-row", "bar-chart"].includes(dt.value)) {
                      const enumField = scalarFields.find((f) => f.type === "enum");
                      updates.aggregation = { type: "countByField", groupByField: enumField?.key };
                      updates.groupByField = enumField?.key;
                    } else {
                      updates.aggregation = undefined;
                    }
                    updateConfig(updates);
                  }}
                  className={`p-3 rounded-lg border text-left transition-colors ${
                    config.displayType === dt.value
                      ? "border-primary bg-primary/5 text-primary"
                      : "border-border hover:border-primary/30"
                  }`}
                >
                  <div className="text-sm font-medium">{dt.label}</div>
                  <div className="text-xs text-muted-foreground">{dt.description}</div>
                </button>
              ))}
            </div>

            {/* Aggregation */}
            {needsAggregation && (
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs font-medium text-muted-foreground">Aggregation</label>
                  <select
                    value={config.aggregation?.type || "count"}
                    onChange={(e) => {
                      const type = e.target.value as AggregationType;
                      const needsField = ["sum", "avg", "min", "max"].includes(type);
                      updateConfig({
                        aggregation: {
                          ...config.aggregation,
                          type,
                          // Pre-pick the first numeric field so "sum"
                          // doesn't silently fall back to a plain count
                          // while the field is unset.
                          field: needsField
                            ? config.aggregation?.field || numericFields[0]?.key
                            : undefined,
                        },
                      });
                    }}
                    className="w-full mt-1 px-2 py-1 text-sm border border-input rounded bg-background"
                  >
                    {scalarAggregations.map((a) => <option key={a} value={a}>{a}</option>)}
                  </select>
                </div>
                {config.aggregation?.type && ["sum", "avg", "min", "max"].includes(config.aggregation.type) && (
                  <div>
                    <label className="text-xs font-medium text-muted-foreground">Numeric Field</label>
                    <select value={config.aggregation?.field || ""} onChange={(e) => updateConfig({ aggregation: { ...config.aggregation!, field: e.target.value || undefined } })}
                      className="w-full mt-1 px-2 py-1 text-sm border border-input rounded bg-background">
                      <option value="">Select field...</option>
                      {numericFields.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
                    </select>
                  </div>
                )}
              </div>
            )}

            {/* Group By */}
            {needsGroupBy && (
              <div>
                <label className="text-xs font-medium text-muted-foreground">Group By Field</label>
                <select value={config.groupByField || config.aggregation?.groupByField || ""}
                  onChange={(e) => {
                    const v = e.target.value || undefined;
                    if (config.displayType === "status-board") {
                      // Status board groups fetched rows client-side.
                      // Setting a countByField aggregation here switched
                      // the query to aggregate mode (rows: []) and blanked
                      // the board.
                      updateConfig({ groupByField: v, aggregation: undefined });
                    } else {
                      updateConfig({
                        groupByField: v,
                        aggregation: { type: "countByField", groupByField: v },
                      });
                    }
                  }}
                  className="w-full mt-1 px-2 py-1 text-sm border border-input rounded bg-background">
                  <option value="">Select field...</option>
                  {/* countByField runs server-side over scalar columns
                      only; the status board groups client-side, where
                      flattened relation values (e.g. Client name) work
                      too. */}
                  {(config.displayType === "status-board" ? fields : scalarFields)
                    .filter((f) => f.type === "enum" || f.type === "string")
                    .map((f) => (
                      <option key={f.key} value={f.key}>{f.label}</option>
                    ))}
                </select>
              </div>
            )}

            {/* Columns for list/table */}
            {needsColumns && (
              <div>
                <label className="text-xs font-medium text-muted-foreground">Columns</label>
                <div className="mt-1 flex flex-wrap gap-1">
                  {fields.map((f) => {
                    const selected = config.columns?.includes(f.key);
                    return (
                      <button key={f.key}
                        onClick={() => {
                          const current = config.columns || [];
                          updateConfig({
                            columns: selected ? current.filter((c) => c !== f.key) : [...current, f.key],
                          });
                        }}
                        className={`px-2 py-1 text-xs rounded-full border transition-colors ${
                          selected ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:border-primary/30"
                        }`}
                      >
                        {f.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Progress bar goal */}
            {config.displayType === "progress-bar" && (
              <div>
                <label className="text-xs font-medium text-muted-foreground">Goal Value</label>
                <input type="number" min={1} value={config.goalValue || 100} onChange={(e) => updateConfig({ goalValue: Number(e.target.value) || 100 })}
                  className="w-full mt-1 px-2 py-1 text-sm border border-input rounded bg-background" />
              </div>
            )}

            {/* Label field for list/status-board */}
            {(config.displayType === "list" || config.displayType === "status-board") && (
              <div>
                <label className="text-xs font-medium text-muted-foreground">Label Field</label>
                <select value={config.labelField || ""} onChange={(e) => updateConfig({ labelField: e.target.value })}
                  className="w-full mt-1 px-2 py-1 text-sm border border-input rounded bg-background">
                  <option value="">Auto (first column)</option>
                  {fields.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
                </select>
              </div>
            )}

            {/* Link to */}
            <div>
              <label className="text-xs font-medium text-muted-foreground">Link To (optional)</label>
              <input type="text" value={config.linkTo || ""} onChange={(e) => updateConfig({ linkTo: e.target.value || undefined })}
                className="w-full mt-1 px-2 py-1 text-sm border border-input rounded bg-background" placeholder="/clients" />
            </div>
          </CardContent>
        </Card>

        {/* Actions */}
        <div className="flex items-center gap-3">
          <Button onClick={handleSave} disabled={saving}>
            <Save className="h-4 w-4 mr-1" /> {saving ? "Saving..." : "Save Widget"}
          </Button>
          <Button variant="outline" onClick={handlePreview} disabled={previewing}>
            <RefreshCw className={`h-4 w-4 mr-1 ${previewing ? "animate-spin" : ""}`} /> Preview
          </Button>
          {message && <span className={`text-sm ${message.type === "success" ? "text-success" : "text-destructive"}`}>{message.text}</span>}
        </div>
      </div>

      {/* Right: Live Preview */}
      <div className="lg:sticky lg:top-4 self-start">
        <Card className="border-2 border-dashed border-primary/20">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm text-primary">Live Preview</CardTitle>
              <Button variant="ghost" size="sm" onClick={handlePreview} disabled={previewing}>
                <RefreshCw className={`h-3.5 w-3.5 ${previewing ? "animate-spin" : ""}`} />
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {!previewData ? (
              <div className="flex items-center justify-center h-40 text-muted-foreground text-sm">
                Click Preview to load data
              </div>
            ) : (
              <div className="border border-border rounded-lg overflow-hidden">
                <Card className="border-0">
                  {config.showHeader !== false && (
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm">{config.title || name}</CardTitle>
                    </CardHeader>
                  )}
                  <CardContent className={config.showHeader !== false ? "" : "p-4"}>
                    {(() => {
                      const Display = DISPLAY_MAP[config.displayType] || DisplayList;
                      return <Display config={config} data={previewData} fields={previewFields} />;
                    })()}
                  </CardContent>
                </Card>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
