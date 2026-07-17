"use client";

/**
 * Admin customization panel for a built-in report.
 *
 * Lets an admin rename the report, rewrite its description, hide it
 * from pickers/digests/scheduled sends, cap displayed rows, and
 * rename / hide / reorder individual columns. Saves to the
 * ReportOverride row; the change applies everywhere runReport is
 * consumed (preview, CSV, email, digest, scheduled tasks).
 *
 * The form drafts locally and only syncs from the server data once
 * (on first load) so a background refresh never clobbers unsaved
 * edits. Reset rebuilds the draft from stock.
 */

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Settings2,
  ChevronDown,
  ChevronUp,
  ArrowUp,
  ArrowDown,
  RotateCcw,
  Loader2,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";
import {
  saveReportOverride,
  resetReportOverride,
} from "@/actions/reports";
import { useConfirm } from "@/components/shared/use-confirm";

interface StockColumn {
  key: string;
  label: string;
}

export interface OverrideView {
  displayName: string | null;
  description: string | null;
  hidden: boolean;
  maxRows: number | null;
  columnConfig: Record<
    string,
    { label?: string; hidden?: boolean; order?: number }
  > | null;
}

interface ColumnDraft {
  key: string;
  stockLabel: string;
  label: string; // draft custom label ("" = stock)
  visible: boolean;
}

interface Props {
  reportKey: string;
  stockName: string;
  stockDescription: string;
  stockColumns: StockColumn[];
  override: OverrideView | null;
  /** Re-run the report so the preview reflects the saved customization. */
  onSaved: () => void;
}

function buildDrafts(
  stockColumns: StockColumn[],
  override: OverrideView | null
): ColumnDraft[] {
  const config = override?.columnConfig ?? {};
  const drafts = stockColumns.map((col, index) => {
    const c = config[col.key];
    return {
      key: col.key,
      stockLabel: col.label,
      label: c?.label ?? "",
      visible: c?.hidden !== true,
      sortKey: c?.order ?? index,
      index,
    };
  });
  // Same ordering rule applyReportOverride uses, so the form shows
  // columns in the order the report renders them.
  drafts.sort((a, b) => a.sortKey - b.sortKey || a.index - b.index);
  return drafts.map(({ key, stockLabel, label, visible }) => ({
    key,
    stockLabel,
    label,
    visible,
  }));
}

export function ReportCustomizePanel({
  reportKey,
  stockName,
  stockDescription,
  stockColumns,
  override,
  onSaved,
}: Props) {
  const router = useRouter();
  const { confirm, ConfirmDialog } = useConfirm();
  const [open, setOpen] = useState(false);
  const [isSaving, startSave] = useTransition();

  const [displayName, setDisplayName] = useState("");
  const [description, setDescription] = useState("");
  const [hidden, setHidden] = useState(false);
  const [maxRows, setMaxRows] = useState("");
  const [cols, setCols] = useState<ColumnDraft[]>([]);
  const [overridden, setOverridden] = useState(false);
  const [status, setStatus] = useState<
    { type: "success" | "error"; message: string } | null
  >(null);

  // Hydrate the draft exactly once from the first run's data. Later
  // refreshes must not stomp in-progress edits.
  const hydratedRef = useRef(false);
  useEffect(() => {
    if (hydratedRef.current || stockColumns.length === 0) return;
    hydratedRef.current = true;
    setDisplayName(override?.displayName ?? "");
    setDescription(override?.description ?? "");
    setHidden(override?.hidden ?? false);
    setMaxRows(override?.maxRows != null ? String(override.maxRows) : "");
    setCols(buildDrafts(stockColumns, override));
    setOverridden(override != null);
  }, [stockColumns, override]);

  const move = (index: number, dir: -1 | 1) => {
    setCols((prev) => {
      const next = [...prev];
      const target = index + dir;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  const patchCol = (index: number, patch: Partial<ColumnDraft>) => {
    setCols((prev) =>
      prev.map((c, i) => (i === index ? { ...c, ...patch } : c))
    );
  };

  const handleSave = () => {
    setStatus(null);

    if (cols.length > 0 && cols.every((c) => !c.visible)) {
      setStatus({
        type: "error",
        message: "At least one column must stay visible.",
      });
      return;
    }
    let parsedMaxRows: number | null = null;
    if (maxRows.trim()) {
      const n = Number(maxRows.trim());
      if (!Number.isInteger(n) || n < 1) {
        setStatus({
          type: "error",
          message: "Row cap must be a whole number of 1 or more (or blank for no cap).",
        });
        return;
      }
      parsedMaxRows = n;
    }

    // Build a minimal diff against stock: only deviations are stored,
    // so untouched columns keep tracking future code changes.
    const orderChanged = cols.some((c, i) => c.key !== stockColumns[i]?.key);
    const columnConfig: Record<
      string,
      { label?: string; hidden?: boolean; order?: number }
    > = {};
    cols.forEach((c, i) => {
      const entry: { label?: string; hidden?: boolean; order?: number } = {};
      const trimmed = c.label.trim();
      if (trimmed && trimmed !== c.stockLabel) entry.label = trimmed;
      if (!c.visible) entry.hidden = true;
      if (orderChanged) entry.order = i;
      if (Object.keys(entry).length > 0) columnConfig[c.key] = entry;
    });

    startSave(async () => {
      const result = await saveReportOverride(reportKey, {
        displayName: displayName.trim(),
        description: description.trim(),
        hidden,
        maxRows: parsedMaxRows,
        columnConfig:
          Object.keys(columnConfig).length > 0 ? columnConfig : null,
      });
      if (!result.success) {
        setStatus({ type: "error", message: result.error });
        return;
      }
      setOverridden(!result.cleared);
      setStatus({
        type: "success",
        message: result.cleared
          ? "Everything matches the built-in defaults — customization cleared."
          : "Saved. This name and layout now apply everywhere the report appears (preview, CSV, emails, digest, scheduled sends).",
      });
      onSaved();
      router.refresh();
    });
  };

  const handleReset = async () => {
    const ok = await confirm({
      title: "Reset to built-in defaults?",
      message:
        "This report goes back to its built-in name, description, and columns everywhere it appears.",
      confirmLabel: "Reset",
    });
    if (!ok) return;
    setStatus(null);
    startSave(async () => {
      const result = await resetReportOverride(reportKey);
      if (!result.success) {
        setStatus({ type: "error", message: result.error });
        return;
      }
      setDisplayName("");
      setDescription("");
      setHidden(false);
      setMaxRows("");
      setCols(buildDrafts(stockColumns, null));
      setOverridden(false);
      setStatus({ type: "success", message: "Reset to built-in defaults." });
      onSaved();
      router.refresh();
    });
  };

  return (
    <Card className="mt-6">
      <ConfirmDialog />
      <CardHeader className="py-4">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex w-full items-center gap-2 text-left"
        >
          <Settings2 className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-semibold flex-1">
            Customize this report
            {overridden && (
              <Badge variant="outline" className="ml-2 text-[10px]">
                customized
              </Badge>
            )}
          </span>
          {open ? (
            <ChevronUp className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          )}
        </button>
        {!open && (
          <p className="text-xs text-muted-foreground mt-1">
            Rename it, rewrite the description, relabel / hide / reorder
            columns, cap rows, or hide the whole report — changes apply
            everywhere it&apos;s used, including emails and the daily digest.
          </p>
        )}
      </CardHeader>
      {open && (
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <Input
                label="Display name"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder={stockName}
                maxLength={120}
              />
              <p className="text-[10px] text-muted-foreground mt-1">
                Blank = keep the built-in name (&ldquo;{stockName}&rdquo;).
              </p>
            </div>
            <div>
              <Input
                label="Row cap (display)"
                type="number"
                min="1"
                value={maxRows}
                onChange={(e) => setMaxRows(e.target.value)}
                placeholder="No cap"
              />
              <p className="text-[10px] text-muted-foreground mt-1">
                Truncates long reports everywhere they render; the summary
                notes when rows were cut.
              </p>
            </div>
          </div>

          <div>
            <Textarea
              label="Description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={stockDescription}
              rows={2}
              maxLength={1000}
            />
            <p className="text-[10px] text-muted-foreground mt-1">
              Blank = keep the built-in description.
            </p>
          </div>

          <label className="flex items-start gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={hidden}
              onChange={(e) => setHidden(e.target.checked)}
              className="mt-0.5"
            />
            <span>
              <span className="font-medium">Hide this report</span>
              <span className="block text-xs text-muted-foreground">
                Removes it from the reports list, the scheduled-task picker,
                and the daily digest, and skips any existing scheduled sends
                (they log a warning instead of emailing). You can still open
                it directly and un-hide it here.
              </span>
            </span>
          </label>

          <div>
            <p className="text-xs font-semibold mb-2">Columns</p>
            {cols.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                Run the report once to load its columns.
              </p>
            ) : (
              <div className="rounded border border-border divide-y divide-border">
                {cols.map((c, i) => (
                  <div key={c.key} className="flex items-center gap-2 p-2">
                    <div className="flex flex-col">
                      <button
                        type="button"
                        onClick={() => move(i, -1)}
                        disabled={i === 0}
                        className="text-muted-foreground hover:text-foreground disabled:opacity-25"
                        aria-label={`Move ${c.stockLabel} up`}
                      >
                        <ArrowUp className="h-3 w-3" />
                      </button>
                      <button
                        type="button"
                        onClick={() => move(i, 1)}
                        disabled={i === cols.length - 1}
                        className="text-muted-foreground hover:text-foreground disabled:opacity-25"
                        aria-label={`Move ${c.stockLabel} down`}
                      >
                        <ArrowDown className="h-3 w-3" />
                      </button>
                    </div>
                    <div className="w-40 shrink-0 min-w-0">
                      <p className="text-xs font-medium truncate" title={c.stockLabel}>
                        {c.stockLabel}
                      </p>
                      <p className="text-[10px] text-muted-foreground font-mono truncate">
                        {c.key}
                      </p>
                    </div>
                    <input
                      type="text"
                      value={c.label}
                      onChange={(e) => patchCol(i, { label: e.target.value })}
                      placeholder={c.stockLabel}
                      maxLength={120}
                      className="flex-1 h-8 rounded border border-input bg-background px-2 text-xs focus:outline-none focus:ring-2 focus:ring-primary min-w-0"
                      aria-label={`Custom label for ${c.stockLabel}`}
                    />
                    <label className="flex items-center gap-1.5 text-xs shrink-0 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={c.visible}
                        onChange={(e) => patchCol(i, { visible: e.target.checked })}
                      />
                      Visible
                    </label>
                  </div>
                ))}
              </div>
            )}
            <p className="text-[10px] text-muted-foreground mt-1">
              Hidden columns are removed from the table, CSV downloads, and
              emails. Label blank = keep the built-in label.
            </p>
          </div>

          {status && (
            <div
              className={`rounded p-3 text-sm flex items-center gap-2 ${
                status.type === "success"
                  ? "bg-success/10 text-success"
                  : "bg-destructive/10 text-destructive"
              }`}
            >
              {status.type === "success" ? (
                <CheckCircle2 className="h-4 w-4 shrink-0" />
              ) : (
                <AlertCircle className="h-4 w-4 shrink-0" />
              )}
              {status.message}
            </div>
          )}

          <div className="flex items-center justify-between">
            <Button
              variant="outline"
              size="sm"
              onClick={handleReset}
              disabled={isSaving || !overridden}
            >
              <RotateCcw className="h-3 w-3 mr-1.5" />
              Reset to defaults
            </Button>
            <Button onClick={handleSave} disabled={isSaving}>
              {isSaving ? (
                <>
                  <Loader2 className="h-3 w-3 mr-1.5 animate-spin" />
                  Saving…
                </>
              ) : (
                "Save customization"
              )}
            </Button>
          </div>
        </CardContent>
      )}
    </Card>
  );
}
