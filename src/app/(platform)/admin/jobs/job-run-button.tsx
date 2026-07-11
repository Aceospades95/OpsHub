"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Play, Eye, CheckCircle2, AlertCircle, X } from "lucide-react";
import { triggerJob, previewJob } from "@/actions/jobs";

/**
 * Run / Preview controls for a registered job. Preview (dry run) only
 * shows for jobs that declare supportsDryRun — it evaluates the job and
 * prints the would-do ledger without sending or writing anything, which
 * is the fastest answer to "why did this job send nothing?".
 */
export function JobRunButton({
  jobKey,
  supportsDryRun = false,
}: {
  jobKey: string;
  supportsDryRun?: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<{
    status: string;
    output?: string;
    error?: string;
    processed?: number;
    dryRun?: boolean;
  } | null>(null);

  const handle = (dryRun: boolean) => {
    setResult(null);
    startTransition(async () => {
      const r = dryRun ? await previewJob(jobKey) : await triggerJob(jobKey);
      // Map the gate-only `{ error }` shape into the run-result shape
      // the UI renders so non-admins see "failed" with a reason.
      if ("error" in r && !("status" in r)) {
        setResult({ status: "failed", error: r.error, dryRun });
      } else {
        setResult({ ...r, dryRun });
      }
      router.refresh();
      // Real runs auto-clear the status chip; previews keep their output
      // panel open until dismissed — the ledger is the whole point.
      if (!dryRun) setTimeout(() => setResult((cur) => (cur?.dryRun ? cur : null)), 5000);
    });
  };

  return (
    <div className="flex flex-col items-end gap-2 shrink-0">
      <div className="flex items-center gap-2">
        {result && !result.output && (
          <div
            className={`flex items-center gap-1 text-xs ${
              result.status === "completed"
                ? "text-success"
                : result.status === "failed"
                  ? "text-destructive"
                  : "text-muted-foreground"
            }`}
          >
            {result.status === "completed" ? (
              <CheckCircle2 className="h-3.5 w-3.5" />
            ) : result.status === "failed" ? (
              <AlertCircle className="h-3.5 w-3.5" />
            ) : null}
            <span>
              {result.error ?? result.status}
              {result.processed != null && ` · ${result.processed}`}
            </span>
          </div>
        )}
        {supportsDryRun && (
          <Button size="sm" variant="outline" onClick={() => handle(true)} disabled={isPending}>
            <Eye className="h-3 w-3 mr-1" />
            {isPending ? "Working…" : "Preview"}
          </Button>
        )}
        <Button size="sm" variant="outline" onClick={() => handle(false)} disabled={isPending}>
          <Play className="h-3 w-3 mr-1" />
          {isPending ? "Running..." : "Run now"}
        </Button>
      </div>
      {result?.output && (
        <div className="w-full max-w-xl rounded border border-border bg-muted/40 p-2 text-left relative">
          <button
            type="button"
            onClick={() => setResult(null)}
            className="absolute top-1.5 right-1.5 p-0.5 text-muted-foreground hover:text-foreground"
            aria-label="Dismiss run output"
          >
            <X className="h-3 w-3" />
          </button>
          <pre className="text-[11px] leading-relaxed whitespace-pre-wrap font-mono text-muted-foreground pr-5">
            {result.output}
          </pre>
        </div>
      )}
    </div>
  );
}
