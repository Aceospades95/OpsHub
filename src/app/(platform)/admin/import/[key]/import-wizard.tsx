"use client";

import { useState, useTransition, useRef } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Upload,
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  RotateCcw,
  Download,
  Eye,
  Play,
} from "lucide-react";
import {
  previewImport,
  previewCommitImport,
  commitImport,
} from "@/actions/import";
import { buildRowResultsCsv } from "@/lib/importers/row-results-csv";

interface ImporterFieldLite {
  key: string;
  label: string;
  required: boolean;
  description: string | null;
}

interface PreviewState {
  headers: string[];
  previewRows: Record<string, string>[];
  totalRows: number;
  mapping: Record<string, string | undefined>;
}

interface RowOutcome {
  row: number;
  status: string;
  message?: string;
  warnings?: string[];
}

interface CommitOutcome {
  imported: number;
  updated: number;
  skipped: number;
  failed: number;
  warnings: number;
  rowOutcomes: RowOutcome[];
}

type ImportModeOption = "create" | "update" | "upsert" | "fill-blanks";

const MODE_OPTIONS: {
  value: ImportModeOption;
  label: string;
  hint: string;
}[] = [
  {
    value: "create",
    label: "Create new only",
    hint: "Rows matching an existing record are skipped. Only new records are created.",
  },
  {
    value: "update",
    label: "Update existing only",
    hint: "Rows with no existing match are skipped. No new records are created.",
  },
  {
    value: "upsert",
    label: "Create + update",
    hint: "New rows are created; matching rows are fully updated in place.",
  },
  {
    value: "fill-blanks",
    label: "Create + fill blanks only",
    hint: "New rows are created; on matches, only currently-empty fields are filled. Existing data is never overwritten.",
  },
];

interface Props {
  importerKey: string;
  fields: ImporterFieldLite[];
  /** When true, render the "Download current data" button alongside the
   *  blank template. Driven by whether the importer's exportRows() is
   *  defined. */
  supportsExport: boolean;
  /** When true, the wizard surfaces the import-mode selector. Driven by
   *  whether the importer's commit() honors ctx.mode via a natural key. */
  supportsUpsert: boolean;
  /** Human-readable description of the natural-key match shown next to
   *  the mode selector. Required when supportsUpsert is true. */
  upsertKeyDescription?: string;
}

/** Client-side blob download of the per-row outcomes as CSV. */
function downloadRowResults(outcomes: RowOutcome[], importerKey: string) {
  const csv = buildRowResultsCsv(outcomes);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `import-${importerKey}-row-results.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function statusBadgeClass(status: string): string {
  switch (status) {
    case "failed":
      return "text-destructive border-destructive/50";
    case "skipped":
      return "text-warning border-warning/50";
    case "updated":
      return "text-blue-600 border-blue-600/50";
    default:
      return "text-success border-success/50";
  }
}

/** The five stat tiles shared by the dry-run and result screens. */
function StatTiles({ outcome }: { outcome: CommitOutcome }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
      <div className="rounded border border-border p-4 text-center">
        <p className="text-3xl font-bold text-success">{outcome.imported}</p>
        <p className="text-xs text-muted-foreground mt-1">Created</p>
      </div>
      <div className="rounded border border-border p-4 text-center">
        <p className="text-3xl font-bold text-blue-600">{outcome.updated}</p>
        <p className="text-xs text-muted-foreground mt-1">Updated</p>
      </div>
      <div className="rounded border border-border p-4 text-center">
        <p className="text-3xl font-bold text-warning">{outcome.skipped}</p>
        <p className="text-xs text-muted-foreground mt-1">Skipped</p>
      </div>
      <div className="rounded border border-border p-4 text-center">
        <p className="text-3xl font-bold text-destructive">{outcome.failed}</p>
        <p className="text-xs text-muted-foreground mt-1">Failed</p>
      </div>
      <div className="rounded border border-border p-4 text-center">
        <p className="text-3xl font-bold text-amber-600">{outcome.warnings}</p>
        <p className="text-xs text-muted-foreground mt-1">Warnings</p>
      </div>
    </div>
  );
}

/**
 * Wizard with four states:
 *   1. Upload — pick a file
 *   2. Map + configure — first-20-rows preview, column mapping, mode
 *   3. Dry run (optional but primary) — full per-row outcomes with
 *      nothing persisted
 *   4. Result — what actually happened
 */
export function ImportWizard({
  importerKey,
  fields,
  supportsExport,
  supportsUpsert,
  upsertKeyDescription,
}: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);
  const [pickedFile, setPickedFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [dryRun, setDryRun] = useState<CommitOutcome | null>(null);
  const [outcome, setOutcome] = useState<CommitOutcome | null>(null);
  // Default "upsert" (Create + update) when the importer matches on a
  // natural key — re-uploading a CSV (intentional or after a partial
  // failure) almost always means "update what's there" rather than
  // "create duplicates."
  const [mode, setMode] = useState<ImportModeOption>(
    supportsUpsert ? "upsert" : "create"
  );

  // ── STEP 1 → 2: Upload + parse + auto-map ─────────
  const handleUpload = () => {
    setError(null);
    if (!pickedFile) {
      setError("Please pick a file first");
      return;
    }
    const formData = new FormData();
    formData.set("importerKey", importerKey);
    formData.set("file", pickedFile);

    startTransition(async () => {
      const result = await previewImport(null, formData);
      if (!result.success) {
        setError(result.error || "Failed to parse CSV");
        return;
      }
      setPreview({
        headers: result.headers || [],
        previewRows: result.previewRows || [],
        totalRows: result.totalRows || 0,
        mapping: result.suggestedMapping || {},
      });
    });
  };

  const buildCommitFormData = (): FormData | null => {
    if (!pickedFile || !preview) return null;

    // Validate required fields are mapped
    const missing = fields
      .filter((f) => f.required && !preview.mapping[f.key])
      .map((f) => f.label);
    if (missing.length > 0) {
      setError(`Missing required mapping: ${missing.join(", ")}`);
      return null;
    }

    const formData = new FormData();
    formData.set("importerKey", importerKey);
    formData.set("file", pickedFile);
    formData.set("mapping", JSON.stringify(preview.mapping));
    formData.set("mode", supportsUpsert ? mode : "create");
    return formData;
  };

  // ── STEP 2 → 3: Dry-run preview (nothing persisted) ──
  const handleDryRun = () => {
    setError(null);
    const formData = buildCommitFormData();
    if (!formData) return;

    startTransition(async () => {
      const result = await previewCommitImport(null, formData);
      if (!result.success) {
        setError(result.error || "Preview failed");
        return;
      }
      setDryRun({
        imported: result.imported || 0,
        updated: result.updated || 0,
        skipped: result.skipped || 0,
        failed: result.failed || 0,
        warnings: result.warnings || 0,
        rowOutcomes: result.rowOutcomes || [],
      });
    });
  };

  // ── STEP 2/3 → 4: Commit ─────────────────────────
  const handleCommit = () => {
    setError(null);
    const formData = buildCommitFormData();
    if (!formData) return;

    startTransition(async () => {
      const result = await commitImport(null, formData);
      if (!result.success) {
        setError(result.error || "Import failed");
        return;
      }
      setDryRun(null);
      setOutcome({
        imported: result.imported || 0,
        updated: result.updated || 0,
        skipped: result.skipped || 0,
        failed: result.failed || 0,
        warnings: result.warnings || 0,
        rowOutcomes: result.rowOutcomes || [],
      });
      router.refresh();
    });
  };

  const handleReset = () => {
    setPickedFile(null);
    setPreview(null);
    setDryRun(null);
    setOutcome(null);
    setError(null);
    if (fileRef.current) fileRef.current.value = "";
  };

  const updateMapping = (fieldKey: string, header: string) => {
    if (!preview) return;
    setPreview({
      ...preview,
      mapping: { ...preview.mapping, [fieldKey]: header || undefined },
    });
  };

  // ── Render: result screen takes priority ─────────
  if (outcome) {
    const issueRows = outcome.rowOutcomes.filter(
      (r) =>
        r.status === "failed" ||
        r.status === "skipped" ||
        (r.warnings && r.warnings.length > 0)
    );

    return (
      <Card>
        <CardHeader>
          <CardTitle>Import complete</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <StatTiles outcome={outcome} />

          {issueRows.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-sm font-semibold">Issues</h3>
              <div className="rounded border border-border divide-y divide-border max-h-96 overflow-y-auto">
                {issueRows.map((r) => (
                  <div key={`${r.row}-${r.status}`} className="flex items-start gap-2 p-2 text-xs">
                    <Badge
                      variant="outline"
                      className={`text-[10px] shrink-0 ${statusBadgeClass(
                        r.status === "imported" || r.status === "updated"
                          ? "skipped" // warning rows get the warning tone
                          : r.status
                      )}`}
                    >
                      Row {r.row} · {r.warnings && r.warnings.length > 0 && r.status !== "failed" && r.status !== "skipped" ? `${r.status} with warnings` : r.status}
                    </Badge>
                    <span className="text-muted-foreground">
                      {[r.message, ...(r.warnings || [])].filter(Boolean).join(" · ")}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex flex-wrap gap-2 justify-end pt-2">
            <Button
              variant="outline"
              onClick={() => downloadRowResults(outcome.rowOutcomes, importerKey)}
            >
              <Download className="h-4 w-4 mr-1.5" />
              Download row results (CSV)
            </Button>
            <Button variant="outline" onClick={handleReset}>
              <RotateCcw className="h-4 w-4 mr-1.5" />
              Import another file
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  // ── Dry-run preview screen ────────────────────────
  if (dryRun && preview) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Preview — nothing has been written</CardTitle>
          <p className="text-sm text-muted-foreground">
            This is a dry run of the full import ({preview.totalRows} row
            {preview.totalRows === 1 ? "" : "s"}, mode:{" "}
            {MODE_OPTIONS.find((m) => m.value === mode)?.label || mode}). All
            changes were rolled back. If the outcomes look right, run the
            import for real.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <StatTiles outcome={dryRun} />

          <div>
            <h3 className="text-sm font-semibold mb-2">
              Per-row outcomes
              {dryRun.rowOutcomes.length < preview.totalRows
                ? ` (first ${dryRun.rowOutcomes.length} of ${preview.totalRows})`
                : ""}
            </h3>
            <div className="rounded border border-border max-h-96 overflow-y-auto">
              <table className="w-full text-xs">
                <thead className="bg-muted/30 sticky top-0">
                  <tr className="text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                    <th className="px-3 py-2 font-semibold w-14">Row</th>
                    <th className="px-3 py-2 font-semibold w-24">Status</th>
                    <th className="px-3 py-2 font-semibold">Message / warnings</th>
                  </tr>
                </thead>
                <tbody>
                  {dryRun.rowOutcomes.map((r) => (
                    <tr
                      key={`${r.row}-${r.status}`}
                      className="border-t border-border/50 align-top"
                    >
                      <td className="px-3 py-1.5 tabular-nums text-muted-foreground">
                        {r.row}
                      </td>
                      <td className="px-3 py-1.5">
                        <Badge
                          variant="outline"
                          className={`text-[10px] ${statusBadgeClass(r.status)}`}
                        >
                          {r.status}
                        </Badge>
                      </td>
                      <td className="px-3 py-1.5 text-muted-foreground">
                        {[r.message, ...(r.warnings || [])].filter(Boolean).join(" · ") || (
                          <span className="text-muted-foreground/40">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {error && (
            <div className="rounded bg-destructive/10 p-3 text-sm text-destructive flex items-center gap-2">
              <AlertCircle className="h-4 w-4 shrink-0" />
              {error}
            </div>
          )}

          <div className="flex justify-between pt-2">
            <Button
              variant="outline"
              onClick={() => {
                setDryRun(null);
                setError(null);
              }}
              disabled={isPending}
            >
              <ArrowLeft className="h-4 w-4 mr-1.5" />
              Back
            </Button>
            <Button onClick={handleCommit} disabled={isPending}>
              {isPending ? (
                "Importing..."
              ) : (
                <>
                  Looks good — run import
                  <Play className="h-4 w-4 ml-1.5" />
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (preview) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Map columns & preview</CardTitle>
          <p className="text-sm text-muted-foreground">
            {preview.totalRows} row{preview.totalRows === 1 ? "" : "s"} parsed.
            Map each importer field to a CSV column. Required fields are marked
            with an asterisk.
          </p>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Mapping form */}
          <div className="space-y-3">
            {fields.map((field) => (
              <div key={field.key} className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-start">
                <div>
                  <p className="text-sm font-medium">
                    {field.label}
                    {field.required && <span className="text-destructive ml-1">*</span>}
                  </p>
                  {field.description && (
                    <p className="text-[10px] text-muted-foreground mt-0.5">
                      {field.description}
                    </p>
                  )}
                </div>
                <div className="col-span-2">
                  <select
                    value={preview.mapping[field.key] || ""}
                    onChange={(e) => updateMapping(field.key, e.target.value)}
                    className="w-full h-9 rounded border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                  >
                    <option value="">— Not mapped —</option>
                    {preview.headers.map((h) => (
                      <option key={h} value={h}>{h}</option>
                    ))}
                  </select>
                </div>
              </div>
            ))}
          </div>

          {/* Preview table */}
          <div>
            <h3 className="text-sm font-semibold mb-2">
              Preview (first {Math.min(20, preview.previewRows.length)} of {preview.totalRows} rows)
            </h3>
            <div className="rounded border border-border overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-muted/30">
                  <tr>
                    {preview.headers.map((h) => (
                      <th key={h} className="text-left p-2 font-semibold whitespace-nowrap">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {preview.previewRows.map((row, idx) => (
                    <tr key={idx} className="border-t border-border/50">
                      {preview.headers.map((h) => (
                        <td key={h} className="p-2 whitespace-nowrap text-muted-foreground">
                          {row[h] || <span className="text-muted-foreground/40">—</span>}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {supportsUpsert && (
            <div className="rounded border border-border bg-muted/30 p-3 space-y-2">
              <p className="text-sm font-medium">How should existing records be handled?</p>
              <p className="text-xs text-muted-foreground">
                {upsertKeyDescription || "Existing rows are matched by their natural key."}
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                {MODE_OPTIONS.map((opt) => (
                  <label
                    key={opt.value}
                    className={`flex items-start gap-2 text-sm cursor-pointer rounded border p-2 transition-colors ${
                      mode === opt.value
                        ? "border-primary bg-primary/5"
                        : "border-border hover:bg-muted/40"
                    }`}
                  >
                    <input
                      type="radio"
                      name="import-mode"
                      value={opt.value}
                      checked={mode === opt.value}
                      onChange={() => setMode(opt.value)}
                      className="mt-0.5"
                    />
                    <span>
                      <span className="font-medium block">{opt.label}</span>
                      <span className="text-xs text-muted-foreground">{opt.hint}</span>
                    </span>
                  </label>
                ))}
              </div>
            </div>
          )}

          {error && (
            <div className="rounded bg-destructive/10 p-3 text-sm text-destructive flex items-center gap-2">
              <AlertCircle className="h-4 w-4 shrink-0" />
              {error}
            </div>
          )}

          <div className="flex flex-wrap justify-between gap-2 pt-2">
            <Button variant="outline" onClick={handleReset} disabled={isPending}>
              <RotateCcw className="h-4 w-4 mr-1.5" />
              Start over
            </Button>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={handleCommit} disabled={isPending}>
                {isPending ? (
                  "Working..."
                ) : (
                  <>
                    Import now
                    <ArrowRight className="h-4 w-4 ml-1.5" />
                  </>
                )}
              </Button>
              <Button onClick={handleDryRun} disabled={isPending}>
                {isPending ? (
                  "Working..."
                ) : (
                  <>
                    <Eye className="h-4 w-4 mr-1.5" />
                    Preview import
                  </>
                )}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  // ── Step 1: pick a file ──────────────────────────
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between flex-wrap gap-2">
          <CardTitle>Upload CSV</CardTitle>
          <div className="flex items-center gap-2">
            <a
              href={`/api/import/${importerKey}/template`}
              download
              className="inline-flex items-center rounded border border-border px-3 py-1.5 text-xs hover:bg-muted transition-colors"
              title="Blank CSV with the expected column headers and a couple of example rows. Use this for a fresh import."
            >
              <Download className="h-3 w-3 mr-1.5" />
              Download blank template
            </a>
            {supportsExport && (
              <a
                href={`/api/import/${importerKey}/export`}
                download
                className="inline-flex items-center rounded border border-primary/40 px-3 py-1.5 text-xs hover:bg-primary/10 transition-colors text-primary"
                title="Every row currently in the database, in the same column shape this importer expects. Edit in Excel and re-upload to update existing records — name/email matches are upserted in place."
              >
                <Download className="h-3 w-3 mr-1.5" />
                Download current data
              </a>
            )}
          </div>
        </div>
        <p className="text-sm text-muted-foreground">
          Pick a CSV file to import. After upload you&rsquo;ll see a preview
          of the first 20 rows, map columns, and can dry-run the whole import
          before committing.
          {supportsExport
            ? " To update existing records, click \"Download current data\", edit in Excel, and re-upload — rows are matched by their key (e.g. email or name) and updated in place."
            : ""}
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded border border-dashed border-border p-6">
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            onChange={(e) => setPickedFile(e.target.files?.[0] || null)}
            className="text-sm file:mr-2 file:rounded file:border file:border-border file:bg-muted file:px-3 file:py-1.5 file:text-xs"
          />
          {pickedFile && (
            <p className="text-xs text-muted-foreground mt-2">
              Selected: <strong>{pickedFile.name}</strong> ({(pickedFile.size / 1024).toFixed(1)} KB)
            </p>
          )}
        </div>

        {/* Field reference. Each row wraps cleanly instead of cropping
         *  the description at 40 chars (the QA stress test flagged
         *  "DefaultValue mid-word truncation" on every importer's
         *  expected-columns box). The full description fits on a
         *  multi-line block under the column key + required flag. */}
        <div className="rounded border border-border p-3 bg-muted/20">
          <p className="text-xs font-semibold mb-2">Expected columns</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2 text-xs">
            {fields.map((field) => (
              <div key={field.key} className="flex flex-col gap-0.5">
                <div className="flex items-center gap-1">
                  <span className="font-mono">{field.key}</span>
                  {field.required && (
                    <span className="text-destructive" title="Required">
                      *
                    </span>
                  )}
                </div>
                {field.description && (
                  <p className="text-[11px] leading-snug text-muted-foreground/80">
                    {field.description}
                  </p>
                )}
              </div>
            ))}
          </div>
          <p className="text-[10px] text-muted-foreground mt-3">
            Column names in your CSV don&rsquo;t need to match exactly — the
            mapping screen lets you wire them up.
          </p>
        </div>

        {error && (
          <div className="rounded bg-destructive/10 p-3 text-sm text-destructive flex items-center gap-2">
            <AlertCircle className="h-4 w-4 shrink-0" />
            {error}
          </div>
        )}

        <div className="flex justify-end">
          <Button onClick={handleUpload} disabled={isPending || !pickedFile}>
            <Upload className="h-4 w-4 mr-1.5" />
            {isPending ? "Parsing..." : "Upload & preview"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
