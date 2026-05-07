import { Download } from "lucide-react";

/**
 * "Download CSV" button surfaced on every list page that has a
 * matching importer with `exportRows()` defined.
 *
 * Symmetry with the import wizard — admins can pull a full snapshot
 * of the table in the same column shape the importer expects, edit
 * it in Excel, and re-upload via /admin/import/[key] to round-trip
 * updates. Non-importable entities (notes, comments, audit logs)
 * don't get this button.
 *
 * Gated by role at the call site (page-level admin check) — the
 * underlying /api/import/[key]/export endpoint is also admin-only,
 * so a non-admin sneaking the URL into their address bar still hits
 * a 403.
 *
 * Renders as a plain anchor with `download` so the browser saves the
 * file rather than navigating to it. No JavaScript required, no
 * fetch indirection — the response stream is the file.
 */
interface Props {
  importerKey: string;
  /** Display label override for the button. Defaults to "Download CSV". */
  label?: string;
  className?: string;
}

export function DownloadCsvButton({
  importerKey,
  label = "Download CSV",
  className = "",
}: Props) {
  return (
    <a
      href={`/api/import/${importerKey}/export`}
      download
      title="Download every row currently in this table as a CSV. Edit in Excel and re-upload via /admin/import to round-trip updates."
      className={
        className ||
        "inline-flex items-center gap-1.5 rounded border border-border bg-background px-3 py-1.5 text-sm hover:bg-muted/40 transition-colors"
      }
    >
      <Download className="h-3.5 w-3.5" />
      {label}
    </a>
  );
}
