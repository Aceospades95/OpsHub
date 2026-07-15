"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { FormDialog } from "@/components/shared/form-dialog";
import { submitWorkLog } from "@/actions/work-logs";
import { Pencil, Plus } from "lucide-react";
import { LogFormFields } from "./log-form-fields";

/**
 * Per-day add/edit entry point on the week grids. Opens a dialog
 * prefilled with the day (and the existing log when editing — the
 * action upserts, so re-submitting corrects the day).
 */
export function SubmitLogButton({
  date,
  existing,
  minDate,
  maxDate,
}: {
  /** "YYYY-MM-DD" the dialog is for. */
  date: string;
  existing?: { hours: number; sites: string | null; notes: string | null } | null;
  minDate?: string;
  maxDate?: string;
}) {
  const [open, setOpen] = useState(false);
  const isEdit = existing != null;

  return (
    <>
      <Button
        size="sm"
        variant={isEdit ? "ghost" : "outline"}
        className="h-7 px-2 text-xs"
        onClick={() => setOpen(true)}
        aria-label={isEdit ? `Edit log for ${date}` : `Log hours for ${date}`}
      >
        {isEdit ? <Pencil className="h-3 w-3" /> : <Plus className="h-3 w-3 mr-1" />}
        {isEdit ? "" : "Log"}
      </Button>
      {/* Mounted per open so useFormState starts fresh each time. */}
      {open && (
        <FormDialog
          open={open}
          onClose={() => setOpen(false)}
          title={isEdit ? `Edit log — ${date}` : `Log hours — ${date}`}
          action={submitWorkLog}
          submitLabel={isEdit ? "Save" : "Submit"}
        >
          {({ fieldErrors }) => (
            <LogFormFields
              defaultDate={date}
              defaultHours={existing?.hours}
              defaultSites={existing?.sites}
              defaultNotes={existing?.notes}
              fieldErrors={fieldErrors}
              minDate={minDate}
              maxDate={maxDate}
            />
          )}
        </FormDialog>
      )}
    </>
  );
}
