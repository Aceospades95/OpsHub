"use client";

import { useId, useRef, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

type ActionResult = { success?: boolean; error?: string } | void | undefined;

interface ConfirmDialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  /** Body text or rich children rendered above the buttons */
  message: ReactNode;
  /** Server action to invoke when the user confirms */
  onConfirm: () => Promise<ActionResult>;
  /** Where to navigate on success. Omit to just refresh. */
  navigateTo?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Visual variant for the confirm button — defaults to destructive */
  variant?: "destructive" | "default";
  /**
   * Round-10 QA: a successful destructive action used to redirect or
   * refresh with no feedback — the user clicked Delete and the page
   * just changed. Pass a `successToast` string to surface
   * `toast.success(successToast)` BEFORE the navigate/refresh fires
   * so the affordance lands on the next page. Omit for the rare
   * confirmation that doesn't warrant a toast.
   */
  successToast?: string;
}

/**
 * Confirmation dialog used by every destructive / one-shot action in the
 * app (delete, archive, unlink, etc.). Centralizes three things that the
 * old per-page handlers got wrong:
 *
 *   1. Errors returned by the server action are surfaced inline. Before
 *      this component, a `result.error` like "Permission denied" was
 *      silently dropped and the button looked dead — the user clicked
 *      Delete and nothing happened.
 *   2. The confirm button shows a busy state while the action runs so
 *      double-clicks don't fire twice.
 *   3. Unexpected throws (network drop, server crash) are caught and
 *      surfaced instead of bubbling up to React as an uncaught promise
 *      rejection that leaves the dialog open with no feedback.
 */
export function ConfirmDialog({
  open,
  onClose,
  title,
  message,
  onConfirm,
  navigateTo,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  variant = "destructive",
  successToast,
}: ConfirmDialogProps) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  // R10-2 first wired alertdialog + describedby at the body so SR
  // users hear the explanation alongside the title.
  // R11-H corrects the initial-focus target: focus lands on the
  // Cancel button, not the destructive button. A keyboard user who
  // hits Enter on a re-opened dialog should default to the safe
  // outcome (cancel), not re-fire a destructive action — same
  // pattern as the WCAG/ARIA APG alertdialog example.
  const messageId = useId();
  const cancelButtonRef = useRef<HTMLButtonElement>(null);

  function handleClose() {
    if (pending) return;
    setError(null);
    onClose();
  }

  function handleConfirm() {
    setError(null);
    startTransition(async () => {
      try {
        const result = await onConfirm();
        if (result && "error" in result && result.error) {
          setError(result.error);
          return;
        }
        // Success path — close, fire the toast (so it lands on the
        // next page when navigateTo is set), then navigate or
        // refresh.
        onClose();
        if (successToast) toast.success(successToast);
        if (navigateTo) {
          router.push(navigateTo);
        } else {
          router.refresh();
        }
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : "Something went wrong. Please try again."
        );
      }
    });
  }

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      title={title}
      role="alertdialog"
      describedBy={messageId}
      initialFocusRef={cancelButtonRef}
    >
      <div id={messageId} className="text-sm text-muted-foreground mb-4">
        {message}
      </div>
      {error && (
        <div className="mb-4 rounded bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}
      <div className="flex justify-end gap-2">
        <Button
          ref={cancelButtonRef}
          variant="outline"
          onClick={handleClose}
          disabled={pending}
        >
          {cancelLabel}
        </Button>
        <Button
          variant={variant}
          onClick={handleConfirm}
          disabled={pending}
        >
          {pending ? "Working…" : confirmLabel}
        </Button>
      </div>
    </Dialog>
  );
}
