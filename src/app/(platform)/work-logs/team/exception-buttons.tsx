"use client";

import { useEffect, useRef, useState } from "react";
import { useFormState } from "react-dom";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { FormDialog } from "@/components/shared/form-dialog";
import { useConfirm } from "@/components/shared/use-confirm";
import { deleteScheduleException, upsertScheduleException } from "@/actions/work-logs";
import { CalendarOff, Trash2 } from "lucide-react";

const TYPE_OPTIONS = [
  { value: "PTO", label: "PTO" },
  { value: "SICK", label: "Sick" },
  { value: "HOLIDAY", label: "Holiday" },
  { value: "UNPAID", label: "Unpaid leave" },
  { value: "OTHER", label: "Other" },
];

/**
 * "Add exception" dialog — a day range on which logs aren't expected.
 * Leaving the employee empty makes it org-wide (company holiday), which
 * is what stops the whole roster being nagged on July 4th.
 */
export function AddExceptionButton({
  users,
  defaultStart,
}: {
  users: { id: string; name: string }[];
  /** "YYYY-MM-DD" default for both date fields (the viewed week's Monday). */
  defaultStart: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        <CalendarOff className="h-4 w-4 mr-1" /> Add exception
      </Button>
      {open && (
        <FormDialog
          open={open}
          onClose={() => setOpen(false)}
          title="Add schedule exception"
          action={upsertScheduleException}
          submitLabel="Save"
        >
          {({ fieldErrors }) => (
            <>
              <Select
                name="userId"
                label="Employee"
                placeholder="Everyone (org-wide holiday)"
                options={users.map((u) => ({ value: u.id, label: u.name }))}
                error={fieldErrors?.userId?.[0]}
              />
              <Select
                name="type"
                label="Type"
                options={TYPE_OPTIONS}
                defaultValue="PTO"
                error={fieldErrors?.type?.[0]}
              />
              <div className="grid grid-cols-2 gap-4">
                <Input
                  name="startDate"
                  label="First day"
                  type="date"
                  required
                  defaultValue={defaultStart}
                  error={fieldErrors?.startDate?.[0]}
                />
                <Input
                  name="endDate"
                  label="Last day"
                  type="date"
                  required
                  defaultValue={defaultStart}
                  error={fieldErrors?.endDate?.[0]}
                />
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="approved" defaultChecked className="rounded accent-primary" />
                Approved
              </label>
              <p className="text-xs text-muted-foreground -mt-2">
                Unapproved exceptions still stop reminders (the person is out either way) but stay
                flagged here for follow-up.
              </p>
              <Textarea name="notes" label="Notes" rows={2} error={fieldErrors?.notes?.[0]} />
            </>
          )}
        </FormDialog>
      )}
    </>
  );
}

/** Delete one exception, with a confirm dialog. */
export function DeleteExceptionButton({ id, label }: { id: string; label: string }) {
  const [state, formAction] = useFormState(deleteScheduleException, null);
  const { confirm, ConfirmDialog } = useConfirm();
  const formRef = useRef<HTMLFormElement>(null);
  const router = useRouter();

  useEffect(() => {
    if (state?.success) router.refresh();
  }, [state, router]);

  return (
    <>
      <form ref={formRef} action={formAction} className="inline">
        <input type="hidden" name="id" value={id} />
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-7 px-2"
          aria-label={`Delete exception: ${label}`}
          onClick={async () => {
            const ok = await confirm({
              title: "Delete this exception?",
              message: label,
              confirmLabel: "Delete",
            });
            if (ok) formRef.current?.requestSubmit();
          }}
        >
          <Trash2 className="h-3.5 w-3.5 text-destructive" />
        </Button>
        {state?.error && <span className="text-xs text-destructive">{state.error}</span>}
      </form>
      <ConfirmDialog />
    </>
  );
}
