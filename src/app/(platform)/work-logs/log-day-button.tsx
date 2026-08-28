"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { FormDialog } from "@/components/shared/form-dialog";
import { submitWorkLog } from "@/actions/work-logs";
import { Plus } from "lucide-react";
import { LogFormFields } from "./log-form-fields";

/**
 * Header-level "Log a day" entry point — the general-purpose sibling
 * of the per-day SubmitLogButton on the week grids. Date defaults to
 * today; the action upserts, so submitting an already-logged day
 * updates it.
 */
export function LogDayButton({
  today,
  minDate,
}: {
  /** "YYYY-MM-DD" of the current UTC day (server-computed). */
  today: string;
  /** Earliest back-fillable date, for the input's min hint. */
  minDate?: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4 mr-2" /> Log a day
      </Button>
      {/* Mounted per open so useFormState starts fresh each time. */}
      {open && (
        <FormDialog
          open={open}
          onClose={() => setOpen(false)}
          title="Log a day"
          action={submitWorkLog}
          submitLabel="Submit log"
        >
          {({ fieldErrors }) => (
            <>
              <p className="text-xs text-muted-foreground">
                Defaults to today. Submitting a day you already logged updates
                it.
              </p>
              <LogFormFields
                defaultDate={today}
                fieldErrors={fieldErrors}
                minDate={minDate}
                maxDate={today}
              />
            </>
          )}
        </FormDialog>
      )}
    </>
  );
}
