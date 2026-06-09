"use client";

import { useFormState, useFormStatus } from "react-dom";
import { useEffect, useRef, useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/shared/use-confirm";

interface FormDialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  action: (prev: unknown, formData: FormData) => Promise<{ success?: boolean; error?: string; fieldErrors?: Record<string, string[]> }>;
  children: (state: { fieldErrors?: Record<string, string[]> }) => React.ReactNode;
  submitLabel?: string;
  navigateTo?: string;
}

/**
 * The footer submit button lives in the Dialog's sticky footer —
 * OUTSIDE the <form> element (wired via the `form` attribute) — so
 * it can't call useFormStatus itself (that only reads the nearest
 * ancestor form). This zero-render bridge sits inside the form and
 * reports the action's pending state up so the footer can disable
 * its buttons and swap the label to "Saving…" while the server
 * action runs.
 */
function FormPendingBridge({
  onPendingChange,
}: {
  onPendingChange: (pending: boolean) => void;
}) {
  const { pending } = useFormStatus();
  useEffect(() => {
    onPendingChange(pending);
    // Reset on unmount so a dialog closed mid-flight doesn't reopen
    // with its buttons stuck disabled.
    return () => onPendingChange(false);
  }, [pending, onPendingChange]);
  return null;
}

/**
 * Snapshot the form's current values. Used by the dirty-check that
 * fires when the user clicks Cancel — the QA stress test flagged
 * Cancel as silently discarding edits, so we now compare the form's
 * state on open vs. on cancel and prompt before closing.
 *
 * We serialize FormData to a sorted [key, value] string so the
 * comparison is order-independent. Files are skipped — File objects
 * don't equal each other across snapshots and would always read as
 * dirty even on a no-op open/cancel.
 */
function snapshotFormValues(form: HTMLFormElement | null): string {
  if (!form) return "";
  const fd = new FormData(form);
  const entries: string[] = [];
  fd.forEach((value, key) => {
    if (value instanceof File) return;
    entries.push(`${key}=${value}`);
  });
  return entries.sort().join("&");
}

export function FormDialog({
  open,
  onClose,
  title,
  action,
  children,
  submitLabel = "Save",
  navigateTo,
}: FormDialogProps) {
  const [state, formAction] = useFormState(action, null);
  const [pending, setPending] = useState(false);
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const initialSnapshotRef = useRef<string>("");
  const { confirm, ConfirmDialog } = useConfirm();

  // On open, wait for the form to mount and snapshot its initial
  // values. The snapshot is the basis for the cancel-time dirty check.
  useEffect(() => {
    if (!open) return;
    // Defer one tick so React has populated defaultValues into the DOM.
    const id = requestAnimationFrame(() => {
      initialSnapshotRef.current = snapshotFormValues(formRef.current);
    });
    return () => cancelAnimationFrame(id);
  }, [open]);

  useEffect(() => {
    if (state?.success) {
      onClose();
      if (navigateTo) {
        router.push(navigateTo);
      } else {
        router.refresh();
      }
    }
  }, [state, onClose, router, navigateTo]);

  const handleCancel = useCallback(async () => {
    // Don't allow closing mid-submit — the action may still land and
    // the success effect would fire against an unmounted dialog.
    if (pending) return;
    const current = snapshotFormValues(formRef.current);
    if (current !== initialSnapshotRef.current) {
      const ok = await confirm({
        title: "Discard unsaved changes?",
        message: "You have unsaved changes. Closing the form will lose them.",
        confirmLabel: "Discard",
        cancelLabel: "Keep editing",
      });
      if (!ok) return;
    }
    onClose();
  }, [onClose, confirm, pending]);

  // Round-6 QA: split the form so action buttons live in the
  // dialog's sticky footer slot. The body scrolls; Cancel / Save
  // never clip even when the form is taller than the viewport.
  // The form element wraps both regions so submit-from-footer
  // still reaches the body's inputs.
  const formId = "form-dialog-form";
  return (
    <>
      <Dialog
        open={open}
        onClose={handleCancel}
        title={title}
        footer={
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={handleCancel}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button type="submit" form={formId} disabled={pending}>
              {pending ? "Saving…" : submitLabel}
            </Button>
          </div>
        }
      >
        {state?.error && (
          <div className="mb-4 rounded bg-destructive/10 p-3 text-sm text-destructive">
            {state.error}
          </div>
        )}
        <form id={formId} ref={formRef} action={formAction} className="space-y-4">
          <FormPendingBridge onPendingChange={setPending} />
          {children({ fieldErrors: state?.fieldErrors })}
        </form>
      </Dialog>
      <ConfirmDialog />
    </>
  );
}
