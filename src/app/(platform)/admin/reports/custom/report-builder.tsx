"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Save, Trash2, X, Eye } from "lucide-react";
import type { CustomReportEntity } from "@prisma/client";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useConfirm } from "@/components/shared/use-confirm";
import {
  createCustomReport,
  updateCustomReport,
  deleteCustomReport,
  previewCustomReport,
} from "@/actions/custom-reports";

import type {
  EntityCatalogEntry,
  PreviewOutput,
  SerializedFilter,
} from "./shared-types";

interface ReportBuilderProps {
  /** Set on edit; null for new. */
  reportId: string | null;
  initial: {
    name: string;
    description: string;
    category: string;
    entityType: CustomReportEntity;
    columns: string[];
    filters: SerializedFilter[];
    sortBy: string;
    limit: string;
    isActive: boolean;
  };
  catalog: EntityCatalogEntry[];
  /** Existing category labels to suggest in the autocomplete. */
  existingCategories: string[];
}

export function ReportBuilder({
  reportId,
  initial,
  catalog,
  existingCategories,
}: ReportBuilderProps) {
  const router = useRouter();

  const [name, setName] = useState(initial.name);
  const [description, setDescription] = useState(initial.description);
  const [category, setCategory] = useState(initial.category);
  const [entityType, setEntityType] = useState<CustomReportEntity>(
    initial.entityType
  );
  const [columns, setColumns] = useState<string[]>(initial.columns);
  const [filters, setFilters] = useState<SerializedFilter[]>(initial.filters);
  const [sortBy, setSortBy] = useState<string>(initial.sortBy);
  const [limit, setLimit] = useState<string>(initial.limit);
  const [isActive, setIsActive] = useState(initial.isActive);

  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [preview, setPreview] = useState<PreviewOutput | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const { confirm, ConfirmDialog } = useConfirm();

  const entityDef = useMemo(
    () => catalog.find((c) => c.entity === entityType) ?? catalog[0],
    [catalog, entityType]
  );

  // Scalar columns only — the report runtime rejects ordering through a
  // relation ("manager.name"), so those never appear as sort options.
  const sortableColumns = useMemo(
    () => entityDef.columns.filter((c) => !c.key.includes(".")),
    [entityDef]
  );

  // When the entity changes, drop any column / filter / sort selection
  // that doesn't apply to the new entity. Keep what survives.
  useEffect(() => {
    const validColumnKeys = new Set(entityDef.columns.map((c) => c.key));
    setColumns((prev) => {
      const filtered = prev.filter((k) => validColumnKeys.has(k));
      return filtered.length > 0
        ? filtered
        : entityDef.defaultColumns;
    });
    const validFilterKeys = new Set(entityDef.filters.map((f) => f.key));
    setFilters((prev) => prev.filter((f) => validFilterKeys.has(f.field)));
    setSortBy((prev) => {
      const stripped = prev.startsWith("-") ? prev.slice(1) : prev;
      if (validColumnKeys.has(stripped) && !stripped.includes(".")) return prev;
      return entityDef.defaultSort ?? "";
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entityType]);

  function toggleColumn(key: string) {
    setColumns((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
    );
  }

  function addFilter(fieldKey: string) {
    const def = entityDef.filters.find((f) => f.key === fieldKey);
    if (!def) return;
    setFilters((prev) => [
      ...prev,
      { field: fieldKey, op: def.operators[0], value: "" },
    ]);
  }

  function updateFilter(idx: number, patch: Partial<SerializedFilter>) {
    setFilters((prev) =>
      prev.map((f, i) => (i === idx ? { ...f, ...patch } : f))
    );
  }

  function removeFilter(idx: number) {
    setFilters((prev) => prev.filter((_, i) => i !== idx));
  }

  function buildPayload() {
    return {
      name: name.trim(),
      description: description.trim() || null,
      category: category.trim() || null,
      entityType,
      columns,
      filters: filters.map((f) => ({
        field: f.field,
        op: f.op,
        value: f.value,
      })),
      // Relation sorts are un-runnable (see sortableColumns) — a stale
      // saved value like "manager.name" gets normalized to the default
      // rather than round-tripping a report that errors when run.
      sortBy:
        sortBy.trim() && !sortBy.includes(".") ? sortBy.trim() : null,
      limit:
        limit.trim() === "" || isNaN(Number(limit))
          ? null
          : Math.max(1, Math.floor(Number(limit))),
      isActive,
    };
  }

  function runPreview() {
    setPreviewing(true);
    setError(null);
    startTransition(async () => {
      try {
        const res = await previewCustomReport(buildPayload());
        if ("error" in res) {
          setError(res.error ?? "Preview failed");
          return;
        }
        setPreview(res.output);
      } catch {
        // Network / unexpected action failure — don't leave the button
        // stuck on "Running…".
        setError("Preview failed. Try again.");
      } finally {
        setPreviewing(false);
      }
    });
  }

  function handleSave() {
    setError(null);
    if (!name.trim()) {
      setError("Name is required");
      return;
    }
    startTransition(async () => {
      try {
        const payload = buildPayload();
        const res = reportId
          ? await updateCustomReport({ id: reportId, ...payload })
          : await createCustomReport(payload);
        if ("error" in res) {
          setError(res.error ?? "Save failed");
          return;
        }
        if (!reportId && "id" in res) {
          router.push(`/admin/reports/custom/${res.id}/edit`);
          return;
        }
        router.refresh();
      } catch {
        setError("Save failed. Try again.");
      }
    });
  }

  async function handleDelete() {
    if (!reportId) return;
    const ok = await confirm({
      title: `Delete "${name}"?`,
      message: "This can't be undone.",
      confirmLabel: "Delete",
    });
    if (!ok) return;
    startTransition(async () => {
      const res = await deleteCustomReport(reportId);
      if ("error" in res) {
        setError(res.error ?? "Delete failed");
        return;
      }
      router.push("/admin/reports");
    });
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6 gap-4 flex-wrap">
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">
            <Link href="/admin/reports" className="hover:underline">
              Reports
            </Link>{" "}
            ›{" "}
            <span>{reportId ? "Edit custom report" : "New custom report"}</span>
          </p>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Untitled report"
            aria-label="Report name"
            className="text-2xl font-bold bg-transparent border-0 outline-none focus:ring-0 p-0 w-full"
          />
        </div>
        <div className="flex items-center gap-2">
          <Link href="/admin/reports">
            <Button variant="outline">
              <X className="h-4 w-4 mr-2" />
              Close
            </Button>
          </Link>
          {reportId && (
            <Button variant="destructive" onClick={handleDelete} disabled={pending}>
              <Trash2 className="h-4 w-4 mr-2" />
              Delete
            </Button>
          )}
          <Button onClick={handleSave} disabled={pending}>
            <Save className="h-4 w-4 mr-2" />
            {pending ? "Saving…" : reportId ? "Save" : "Create"}
          </Button>
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded border border-destructive/50 bg-destructive/10 px-4 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Basics</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <Textarea
                label="Description (optional)"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
              />
              <div>
                <Input
                  label="Category (optional)"
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  placeholder="e.g. Compliance, Sales, Internal"
                  list="custom-report-categories"
                />
                {existingCategories.length > 0 && (
                  <datalist id="custom-report-categories">
                    {existingCategories.map((c) => (
                      <option key={c} value={c} />
                    ))}
                  </datalist>
                )}
                <p className="text-xs text-muted-foreground mt-1">
                  Used to group reports on{" "}
                  <code>/admin/reports</code>. Reuse an existing label or
                  type a new one.
                </p>
              </div>
              <Select
                label="What does this report list?"
                value={entityType}
                onChange={(e) =>
                  setEntityType(e.target.value as CustomReportEntity)
                }
                options={catalog.map((c) => ({
                  label: c.label,
                  value: c.entity,
                }))}
              />
              <p className="text-xs text-muted-foreground -mt-2">
                {entityDef.description}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Columns</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-muted-foreground mb-3">
                Pick which fields show in the table. Click to toggle —
                checked columns appear in the order listed below.
              </p>
              <div className="grid grid-cols-2 gap-1.5">
                {entityDef.columns.map((c) => {
                  const checked = columns.includes(c.key);
                  return (
                    <label
                      key={c.key}
                      className={`flex items-center gap-2 text-xs p-1.5 rounded cursor-pointer hover:bg-muted/50 ${
                        checked ? "bg-muted/30" : ""
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleColumn(c.key)}
                      />
                      <span className="font-medium">{c.label}</span>
                      <span className="text-[10px] text-muted-foreground font-mono ml-auto">
                        {c.key}
                      </span>
                    </label>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">Filters</CardTitle>
                <Select
                  value=""
                  onChange={(e) => {
                    if (e.target.value) {
                      addFilter(e.target.value);
                      e.target.value = "";
                    }
                  }}
                  placeholder="Add filter…"
                  options={entityDef.filters.map((f) => ({
                    label: f.label,
                    value: f.key,
                  }))}
                  className="h-8 w-44 text-xs"
                />
              </div>
            </CardHeader>
            <CardContent className="space-y-2">
              {filters.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  No filters. The report will return all rows up to the
                  row limit.
                </p>
              ) : (
                filters.map((f, idx) => {
                  const def = entityDef.filters.find((x) => x.key === f.field);
                  if (!def) return null;
                  const supportsValue =
                    f.op !== "isNull" && f.op !== "isNotNull";
                  return (
                    <div
                      key={idx}
                      className="flex items-center gap-2 rounded border border-border bg-muted/30 p-2"
                    >
                      <span className="text-xs font-medium min-w-[120px]">
                        {def.label}
                      </span>
                      <Select
                        value={f.op}
                        onChange={(e) => {
                          const nextOp = e.target.value as SerializedFilter["op"];
                          // Leaving "in" for a single-value operator: keep
                          // only the first picked value so the filter
                          // doesn't silently no-op with "A,B" as an equals
                          // value.
                          const patch: Partial<SerializedFilter> =
                            f.op === "in" && nextOp !== "in"
                              ? { op: nextOp, value: splitInList(f.value)[0] ?? "" }
                              : { op: nextOp };
                          updateFilter(idx, patch);
                        }}
                        options={def.operators.map((o) => ({
                          label: opLabel(o),
                          value: o,
                        }))}
                        className="h-8 w-32 text-xs"
                      />
                      {supportsValue &&
                        (def.type === "enum" && def.enumValues ? (
                          f.op === "in" ? (
                            // "in" accepts a comma-separated list — a single
                            // select would cap it at one value, so render
                            // toggleable chips instead.
                            <div className="flex flex-1 flex-wrap gap-1">
                              {def.enumValues.map((v) => {
                                const selected = splitInList(f.value);
                                const active = selected.includes(v);
                                return (
                                  <button
                                    key={v}
                                    type="button"
                                    aria-pressed={active}
                                    onClick={() => {
                                      const next = active
                                        ? selected.filter((x) => x !== v)
                                        : [...selected, v];
                                      updateFilter(idx, {
                                        value: next.join(","),
                                      });
                                    }}
                                    className={`px-2 py-0.5 text-[10px] rounded-full border transition-colors ${
                                      active
                                        ? "border-primary bg-primary/10 text-primary"
                                        : "border-border text-muted-foreground hover:border-primary/40"
                                    }`}
                                  >
                                    {v}
                                  </button>
                                );
                              })}
                            </div>
                          ) : (
                            <Select
                              value={String(f.value ?? "")}
                              onChange={(e) =>
                                updateFilter(idx, { value: e.target.value })
                              }
                              options={def.enumValues.map((v) => ({
                                label: v,
                                value: v,
                              }))}
                              placeholder="Pick"
                              className="h-8 flex-1 text-xs"
                            />
                          )
                        ) : def.type === "boolean" ? (
                          <Select
                            value={String(f.value ?? "")}
                            onChange={(e) =>
                              updateFilter(idx, {
                                value: e.target.value === "true",
                              })
                            }
                            options={[
                              { label: "true", value: "true" },
                              { label: "false", value: "false" },
                            ]}
                            placeholder="Value"
                            className="h-8 flex-1 text-xs"
                          />
                        ) : def.type === "date" ? (
                          <Input
                            type="date"
                            value={String(f.value ?? "")}
                            onChange={(e) =>
                              updateFilter(idx, { value: e.target.value })
                            }
                            className="h-8 flex-1 text-xs"
                          />
                        ) : (
                          <Input
                            type={def.type === "number" ? "number" : "text"}
                            value={String(f.value ?? "")}
                            onChange={(e) =>
                              updateFilter(idx, { value: e.target.value })
                            }
                            placeholder={
                              f.op === "in"
                                ? "Comma-separated"
                                : "Value"
                            }
                            className="h-8 flex-1 text-xs"
                          />
                        ))}
                      <button
                        type="button"
                        onClick={() => removeFilter(idx)}
                        className="p-1 text-muted-foreground hover:text-destructive"
                        aria-label="Remove filter"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  );
                })
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Sort & limit</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-3">
              <Select
                label="Sort by"
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
                placeholder="Default"
                options={[
                  // Relation columns ("manager.name" etc.) are excluded:
                  // the runtime can't order through a relation, so
                  // offering them here produced reports that error out.
                  ...sortableColumns.map((c) => ({
                    label: `${c.label} ↑`,
                    value: c.key,
                  })),
                  ...sortableColumns.map((c) => ({
                    label: `${c.label} ↓`,
                    value: `-${c.key}`,
                  })),
                ]}
              />
              <Input
                label="Row limit"
                type="number"
                min="1"
                value={limit}
                onChange={(e) => setLimit(e.target.value)}
                placeholder={`Default ${entityDef.defaultLimit}`}
              />
              <label className="col-span-2 flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={isActive}
                  onChange={(e) => setIsActive(e.target.checked)}
                />
                Active (available to email from Scheduled Tasks)
              </label>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">Preview</CardTitle>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={runPreview}
                  disabled={previewing}
                >
                  <Eye className="h-3 w-3 mr-1" />
                  {previewing ? "Running…" : "Run preview"}
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {!preview ? (
                <p className="text-xs text-muted-foreground">
                  Click <strong>Run preview</strong> to see the first 50
                  rows against current data. Run it again after changing
                  columns or filters to refresh the result.
                </p>
              ) : (
                <div className="text-xs">
                  <p className="text-muted-foreground mb-2">
                    {preview.summary}
                  </p>
                  {preview.rows.length === 0 ? (
                    <p className="text-muted-foreground">No matching rows.</p>
                  ) : (
                    // The panel is narrow (1/3 grid column) — without
                    // nowrap cells the table crushed every column and
                    // wrapped values line-by-line. Headers and cells stay
                    // on one line; the wrapper scrolls horizontally and
                    // long free-text truncates with the full value on
                    // hover.
                    <div className="overflow-x-auto">
                      <table className="w-full">
                        <thead>
                          <tr className="text-[10px] uppercase tracking-wide text-muted-foreground">
                            {preview.columns.map((c) => (
                              <th
                                key={c.key}
                                className={`pb-1.5 px-1.5 whitespace-nowrap ${
                                  c.align === "right"
                                    ? "text-right"
                                    : c.align === "center"
                                      ? "text-center"
                                      : "text-left"
                                }`}
                              >
                                {c.label}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {preview.rows.map((row, i) => (
                            <tr key={i} className="border-t border-border">
                              {preview.columns.map((c) => (
                                <td
                                  key={c.key}
                                  title={row[c.key]}
                                  className={`py-1.5 px-1.5 max-w-[16rem] truncate ${
                                    c.align === "right"
                                      ? "text-right tabular-nums"
                                      : c.align === "center"
                                        ? "text-center"
                                        : ""
                                  }`}
                                >
                                  {row[c.key]}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
      <ConfirmDialog />
    </div>
  );
}

/** Split a saved "in" filter value into its list items. Mirrors the
 *  runtime, which splits on commas/semicolons/whitespace. */
function splitInList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  return String(value ?? "")
    .split(/[,;\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function opLabel(op: SerializedFilter["op"]): string {
  switch (op) {
    case "equals":
      return "equals";
    case "contains":
      return "contains";
    case "in":
      return "in";
    case "gt":
      return "greater than";
    case "gte":
      return "≥";
    case "lt":
      return "less than";
    case "lte":
      return "≤";
    case "isNull":
      return "is empty";
    case "isNotNull":
      return "is set";
  }
}
