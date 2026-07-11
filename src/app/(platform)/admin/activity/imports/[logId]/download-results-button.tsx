"use client";

import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  buildRowResultsCsv,
  type RowResultLite,
} from "@/lib/importers/row-results-csv";

/**
 * Client-side "Download row results (CSV)" button for the import-log
 * detail page. Builds the CSV from the already-parsed outcomes and
 * downloads it as a blob — no extra server round trip.
 */
export function DownloadResultsButton({
  outcomes,
  filename,
}: {
  outcomes: RowResultLite[];
  filename: string;
}) {
  const handleDownload = () => {
    const csv = buildRowResultsCsv(outcomes);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <Button variant="outline" size="sm" onClick={handleDownload}>
      <Download className="h-4 w-4 mr-1.5" />
      Download row results (CSV)
    </Button>
  );
}
