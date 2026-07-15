"use client";

import { useEffect, useRef } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { submitWorkLog } from "@/actions/work-logs";
import { LogFormFields } from "./log-form-fields";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Saving…" : "Submit log"}
    </Button>
  );
}

/**
 * The always-visible quick-submit card on /work-logs — date defaults to
 * today; submitting for an already-logged day updates it (upsert).
 */
export function QuickLogForm({
  today,
  minDate,
}: {
  /** "YYYY-MM-DD" of the current UTC day (server-computed). */
  today: string;
  /** Earliest back-fillable date, for the input's min hint. */
  minDate?: string;
}) {
  const [state, formAction] = useFormState(submitWorkLog, null);
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state?.success) {
      formRef.current?.reset();
      router.refresh();
    }
  }, [state, router]);

  return (
    <form ref={formRef} action={formAction} className="space-y-4">
      {state?.error && (
        <div className="rounded bg-destructive/10 p-3 text-sm text-destructive">{state.error}</div>
      )}
      {state?.success && (
        <div className="rounded bg-[color-mix(in_srgb,var(--success)_12%,transparent)] p-3 text-sm">
          Log saved.
        </div>
      )}
      <LogFormFields
        defaultDate={today}
        fieldErrors={state && "fieldErrors" in state ? state.fieldErrors : undefined}
        minDate={minDate}
        maxDate={today}
      />
      <div className="flex justify-end">
        <SubmitButton />
      </div>
    </form>
  );
}
