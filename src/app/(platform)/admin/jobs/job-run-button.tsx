"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Play, CheckCircle2, AlertCircle } from "lucide-react";
import { triggerJob } from "@/actions/jobs";

export function JobRunButton({ jobKey }: { jobKey: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<{
    status: string;
    output?: string;
    error?: string;
    processed?: number;
  } | null>(null);

  const handleRun = () => {
    setResult(null);
    startTransition(async () => {
      const r = await triggerJob(jobKey);
      setResult(r);
      router.refresh();
      // Auto-clear after a few seconds so the button doesn't stay decorated
      setTimeout(() => setResult(null), 5000);
    });
  };

  return (
    <div className="flex items-center gap-2 shrink-0">
      {result && (
        <div
          className={`flex items-center gap-1 text-xs ${
            result.status === "completed"
              ? "text-emerald-600"
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
            {result.status}
            {result.processed != null && ` · ${result.processed}`}
          </span>
        </div>
      )}
      <Button size="sm" variant="outline" onClick={handleRun} disabled={isPending}>
        <Play className="h-3 w-3 mr-1" />
        {isPending ? "Running..." : "Run now"}
      </Button>
    </div>
  );
}
