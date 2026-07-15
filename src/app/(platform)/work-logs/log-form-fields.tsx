import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

/**
 * The shared field set for submitting/editing one daily log — used by
 * the inline quick-submit form and the per-day edit dialog so the two
 * entry points can't drift. Server-safe (no hooks).
 */
export function LogFormFields({
  defaultDate,
  defaultHours,
  defaultSites,
  defaultNotes,
  fieldErrors,
  maxDate,
  minDate,
}: {
  defaultDate: string;
  defaultHours?: number | null;
  defaultSites?: string | null;
  defaultNotes?: string | null;
  fieldErrors?: Record<string, string[]>;
  /** "YYYY-MM-DD" bounds for the date input (UI hint; the action re-validates). */
  maxDate?: string;
  minDate?: string;
}) {
  return (
    <>
      <div className="grid grid-cols-2 gap-4">
        <Input
          name="workDate"
          label="Work date"
          type="date"
          required
          defaultValue={defaultDate}
          min={minDate}
          max={maxDate}
          error={fieldErrors?.workDate?.[0]}
        />
        <Input
          name="hours"
          label="Hours worked"
          type="number"
          step="0.25"
          min={0}
          max={24}
          required
          defaultValue={defaultHours != null ? String(defaultHours) : ""}
          placeholder="8"
          error={fieldErrors?.hours?.[0]}
        />
      </div>
      <Input
        name="sites"
        label="Tickets / sites"
        placeholder='e.g. "PHLF014 Service call"'
        defaultValue={defaultSites ?? ""}
        error={fieldErrors?.sites?.[0]}
      />
      <Textarea
        name="notes"
        label="Notes"
        rows={2}
        defaultValue={defaultNotes ?? ""}
        error={fieldErrors?.notes?.[0]}
      />
    </>
  );
}
