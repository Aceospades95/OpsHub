"use client";

import { useFormState } from "react-dom";
import { useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

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
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const initialSnapshotRef = useRef<string>("");

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

  const handleCancel = useCallback(() => {
    const current = snapshotFormValues(formRef.current);
    if (
      current !== initialSnapshotRef.current &&
      typeof window !== "undefined" &&
      !window.confirm(
        "You have unsaved changes. Discard them and close the form?"
      )
    ) {
      return;
    }
    onClose();
  }, [onClose]);

  return (
    <Dialog open={open} onClose={handleCancel} title={title}>
      {state?.error && (
        <div className="mb-4 rounded bg-destructive/10 p-3 text-sm text-destructive">
          {state.error}
        </div>
      )}
      <form ref={formRef} action={formAction} className="space-y-4">
        {children({ fieldErrors: state?.fieldErrors })}
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={handleCancel}>
            Cancel
          </Button>
          <Button type="submit">
            {submitLabel}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
