"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { CheckCircle2 } from "lucide-react";
import { setJobParams } from "@/actions/jobs";
import type { JobParamField } from "@/lib/jobs";

/**
 * Settings form generated from a job's declared paramsSchema. Values
 * merge over code defaults at run time (getJobParams) — clearing a
 * field falls back to the default shown in its placeholder.
 */
export function JobParamsForm({
  jobKey,
  schema,
  current,
  defaults,
}: {
  jobKey: string;
  schema: JobParamField[];
  /** Stored JobConfig.params (already-filtered server-side). */
  current: Record<string, number | boolean>;
  /** Code defaults, shown as placeholders / fallback labels. */
  defaults: Record<string, number | boolean>;
}) {
  const router = useRouter();
  const [values, setValues] = useState<Record<string, string>>(() => {
    const v: Record<string, string> = {};
    for (const f of schema) {
      const stored = current[f.key];
      v[f.key] = stored === undefined ? "" : String(stored);
    }
    return v;
  });
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  function handleSave() {
    setError(null);
    startTransition(async () => {
      const payload: Record<string, unknown> = {};
      for (const f of schema) payload[f.key] = values[f.key];
      const res = await setJobParams(jobKey, payload);
      if (res && "error" in res && res.error) {
        setError(res.error);
        return;
      }
      setSaved(true);
      router.refresh();
      setTimeout(() => setSaved(false), 2500);
    });
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {schema.map((f) => (
          <div key={f.key}>
            <label className="block text-xs font-medium mb-1" htmlFor={`param-${f.key}`}>
              {f.label}
            </label>
            {f.type === "boolean" ? (
              <select
                id={`param-${f.key}`}
                value={values[f.key]}
                onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                className="w-full h-9 rounded border border-input bg-background px-2 text-sm"
              >
                <option value="">
                  {defaults[f.key] !== undefined ? `Default (${String(defaults[f.key])})` : "Code default"}
                </option>
                <option value="true">Yes</option>
                <option value="false">No</option>
              </select>
            ) : (
              <input
                id={`param-${f.key}`}
                type="number"
                min={f.min}
                value={values[f.key]}
                onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                placeholder={
                  defaults[f.key] !== undefined ? `Default: ${String(defaults[f.key])}` : "Code default"
                }
                className="w-full h-9 rounded border border-input bg-background px-3 text-sm"
              />
            )}
            {f.help && (
              <p className="text-[11px] text-muted-foreground mt-0.5">{f.help}</p>
            )}
          </div>
        ))}
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
      <div className="flex items-center gap-2">
        <Button size="sm" onClick={handleSave} disabled={pending}>
          {saved ? (
            <>
              <CheckCircle2 className="h-4 w-4 mr-1.5 text-success" />
              Saved
            </>
          ) : pending ? (
            "Saving…"
          ) : (
            "Save settings"
          )}
        </Button>
        <p className="text-[11px] text-muted-foreground">
          Blank fields use the code default. Changes apply on the next run.
        </p>
      </div>
    </div>
  );
}
