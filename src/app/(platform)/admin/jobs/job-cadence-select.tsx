"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { setJobCadence } from "@/actions/jobs";

const OPTIONS: { value: ""; label: string } | { value: string; label: string }[] = [
  { value: "", label: "Default (code)" },
  { value: "HOURLY", label: "Hourly" },
  { value: "DAILY", label: "Daily" },
  { value: "WEEKLY", label: "Weekly" },
  { value: "MONTHLY", label: "Monthly" },
  { value: "DISABLED", label: "Skip cadence (manual only)" },
];

interface Props {
  jobKey: string;
  /** Current override from JobConfig.cadence; empty string when unset
   *  (the job uses its code-defined cadence). */
  current: string;
}

/**
 * Per-job cadence override dropdown shown on /admin/jobs. Saves
 * immediately on change — there's no separate "Save" button because
 * the surrounding row already feels like a settings panel and a
 * confirmation dialog for a one-field change is overkill.
 *
 * Errors land in a small inline label so the admin sees them without
 * a route refresh; success refreshes the page so the cadence label on
 * the row picks up the new value.
 */
export function JobCadenceSelect({ jobKey, current }: Props) {
  const router = useRouter();
  const [value, setValue] = useState(current);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleChange(next: string) {
    setError(null);
    const previous = value;
    setValue(next);
    startTransition(async () => {
      const r = await setJobCadence(jobKey, next === "" ? null : next);
      if ("error" in r && r.error) {
        setError(r.error);
        setValue(previous);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col items-end gap-0.5">
      <select
        value={value}
        disabled={isPending}
        onChange={(e) => handleChange(e.target.value)}
        className="text-xs border border-input rounded-md bg-background px-2 py-1 disabled:opacity-50"
        title="Override the cadence for this job"
      >
        {(OPTIONS as Array<{ value: string; label: string }>).map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
      {error && (
        <span className="text-[10px] text-destructive max-w-[180px] text-right">
          {error}
        </span>
      )}
    </div>
  );
}
