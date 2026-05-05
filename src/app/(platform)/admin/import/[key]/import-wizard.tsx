"use client";

import { useState, useTransition, useRef } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Upload,
  CheckCircle2,
  AlertCircle,
  ArrowRight,
  RotateCcw,
  Download,
} from "lucide-react";
import { previewImport, commitImport } from "@/actions/import";

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

interface CommitOutcome {
  imported: number;
  updated: number;
  skipped: number;
  failed: number;
  rowOutcomes: { row: number; status: string; message?: string }[];
}

interface Props {
  importerKey: string;
  fields: ImporterFieldLite[];
  /** When true, render the "Download current data" button alongside the
   *  blank template. Driven by whether the importer's exportRows() is
   *  defined. */
  supportsExport: boolean;
  /** When true, the wizard surfaces the "Update existing rows on match"
   *  toggle. Driven by whether the importer's commit() honors
   *  ctx.mode === "upsert". */
  supportsUpsert: boolean;
  /** Human-readable description of the natural-key match shown next to
   *  the toggle. Required when supportsUpsert is true. */
  upsertKeyDescription?: string;
}

/**
 * Wizard with three states:
 *   1. Upload — pick a file
 *   2. Preview + map — show first 20 rows + mapping form
 *   3. Result — show how many rows imported / skipped / failed
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
  const [outcome, setOutcome] = useState<CommitOutcome | null>(null);
  // Default ON when the importer supports upsert. Re-uploading a CSV
  // (intentional or after a partial failure) almost always means
  // "update what's there" rather than "create duplicates."
  const [upsertMode, setUpsertMode] = useState<boolean>(supportsUpsert);

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

  // ── STEP 2 → 3: Commit ─────────────────────────
  const handleCommit = () => {
    setError(null);
    if (!pickedFile || !preview) return;

    // Validate required fields are mapped
    const missing = fields
      .filter((f) => f.required && !preview.mapping[f.key])
      .map((f) => f.label);
    if (missing.length > 0) {
      setError(`Missing required mapping: ${missing.join(", ")}`);
      return;
    }

    const formData = new FormData();
    formData.set("importerKey", importerKey);
    formData.set("file", pickedFile);
    formData.set("mapping", JSON.stringify(preview.mapping));
    formData.set("mode", supportsUpsert && upsertMode ? "upsert" : "create");

    startTransition(async () => {
      const result = await commitImport(null, formData);
      if (!result.success) {
        setError(result.error || "Import failed");
        return;
      }
      setOutcome({
        imported: result.imported || 0,
        updated: result.updated || 0,
        skipped: result.skipped || 0,
        failed: result.failed || 0,
        rowOutcomes: result.rowOutcomes || [],
      });
      router.refresh();
    });
  };

  const handleReset = () => {
    setPickedFile(null);
    setPreview(null);
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

  // ── Render: result screen takes priority over preview ──
  if (outcome) {
    const failedRows = outcome.rowOutcomes.filter((r) => r.status === "failed");
    const skippedRows = outcome.rowOutcomes.filter((r) => r.status === "skipped");

    return (
      <Card>
        <CardHeader>
          <CardTitle>Import complete</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div className="rounded border border-border p-4 text-center">
              <p className="text-3xl font-bold text-emerald-600">{outcome.imported}</p>
              <p className="text-xs text-muted-foreground mt-1">Created</p>
            </div>
            <div className="rounded border border-border p-4 text-center">
              <p className="text-3xl font-bold text-blue-600">{outcome.updated}</p>
              <p className="text-xs text-muted-foreground mt-1">Updated</p>
            </div>
            <div className="rounded border border-border p-4 text-center">
              <p className="text-3xl font-bold text-amber-600">{outcome.skipped}</p>
              <p className="text-xs text-muted-foreground mt-1">Skipped</p>
            </div>
            <div className="rounded border border-border p-4 text-center">
              <p className="text-3xl font-bold text-destructive">{outcome.failed}</p>
              <p className="text-xs text-muted-foreground mt-1">Failed</p>
            </div>
          </div>

          {(failedRows.length > 0 || skippedRows.length > 0) && (
            <div className="space-y-2">
              <h3 className="text-sm font-semibold">Issues</h3>
              <div className="rounded border border-border divide-y divide-border max-h-96 overflow-y-auto">
                {[...failedRows, ...skippedRows].map((r) => (
                  <div key={`${r.row}-${r.status}`} className="flex items-start gap-2 p-2 text-xs">
                    <Badge
                      variant="outline"
                      className={`text-[10px] shrink-0 ${
                        r.status === "failed"
                          ? "text-destructive border-destructive/50"
                          : "text-amber-600 border-amber-500/50"
                      }`}
                    >
                      Row {r.row}
                    </Badge>
                    <span className="text-muted-foreground">{r.message}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex gap-2 justify-end pt-2">
            <Button variant="outline" onClick={handleReset}>
              <RotateCcw className="h-4 w-4 mr-1.5" />
              Import another file
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
          <CardTitle>Map columns &amp; preview</CardTitle>
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
            <div className="rounded border border-border bg-muted/30 p-3">
              <label className="flex items-start gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={upsertMode}
                  onChange={(e) => setUpsertMode(e.target.checked)}
                  className="mt-0.5 rounded"
                />
                <div className="space-y-1">
                  <p className="font-medium">Update existing rows on match</p>
                  <p className="text-xs text-muted-foreground">
                    {upsertKeyDescription || "Match existing rows by their natural key and update them in place."}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {upsertMode
                      ? "Rows that match existing records will be UPDATED. New rows will be created."
                      : "Rows that match existing records will be SKIPPED. Only new rows will be created."}
                  </p>
                </div>
              </label>
            </div>
          )}

          {error && (
            <div className="rounded bg-destructive/10 p-3 text-sm text-destructive flex items-center gap-2">
              <AlertCircle className="h-4 w-4 shrink-0" />
              {error}
            </div>
          )}

          <div className="flex justify-between pt-2">
            <Button variant="outline" onClick={handleReset} disabled={isPending}>
              <RotateCcw className="h-4 w-4 mr-1.5" />
              Start over
            </Button>
            <Button onClick={handleCommit} disabled={isPending}>
              {isPending ? (
                "Importing..."
              ) : (
                <>
                  Import {preview.totalRows} row{preview.totalRows === 1 ? "" : "s"}
                  <ArrowRight className="h-4 w-4 ml-1.5" />
                </>
              )}
            </Button>
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
          of the first 20 rows and can map columns before committing.
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

        {/* Field reference */}
        <div className="rounded border border-border p-3 bg-muted/20">
          <p className="text-xs font-semibold mb-2">Expected columns</p>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
            {fields.map((field) => (
              <div key={field.key} className="flex items-center gap-1">
                <span className="font-mono">{field.key}</span>
                {field.required && <span className="text-destructive">*</span>}
                {field.description && (
                  <span className="text-muted-foreground/70 truncate" title={field.description}>
                    — {field.description.slice(0, 40)}
                  </span>
                )}
              </div>
            ))}
          </div>
          <p className="text-[10px] text-muted-foreground mt-2">
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
            {isPending ? "Parsing..." : "Upload &amp; preview"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
