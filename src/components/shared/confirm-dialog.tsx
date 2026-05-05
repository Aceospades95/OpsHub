"use client";

import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
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
}: ConfirmDialogProps) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

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
        // Success path — close, then navigate or refresh
        onClose();
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
    <Dialog open={open} onClose={handleClose} title={title}>
      <div className="text-sm text-muted-foreground mb-4">{message}</div>
      {error && (
        <div className="mb-4 rounded bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={handleClose} disabled={pending}>
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
