"use client";

/**
 * useConfirm — drop-in replacement for `window.confirm()` that opens
 * an accessible modal dialog instead of the browser's native one.
 *
 * Native `confirm()` is a UX dead-zone — it freezes the page, can't
 * be styled, doesn't match the rest of the app, gets blocked by
 * some popup blockers, and screen-readers announce it inconsistently.
 * R11-H sweeps every native `confirm()` call out of the React tree;
 * this hook is the migration target.
 *
 * Shape mirrors `confirm()` so the migration is mechanical:
 *
 *     // Before:
 *     async function handleDelete() {
 *       if (!confirm("Delete this widget?")) return;
 *       await deleteWidget();
 *     }
 *
 *     // After:
 *     const { confirm, ConfirmDialog } = useConfirm();
 *     async function handleDelete() {
 *       const ok = await confirm({ title: "Delete this widget?" });
 *       if (!ok) return;
 *       await deleteWidget();
 *     }
 *     return (
 *       <>
 *         {/* existing JSX *\/}
 *         <ConfirmDialog />
 *       </>
 *     );
 *
 * The dialog defers to `<Dialog>` for focus trap, escape-closes,
 * and the labeled-by/described-by wiring — same accessibility
 * envelope as the existing ConfirmDialog component.
 */

import { useCallback, useId, useRef, useState, type ReactNode } from "react";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

interface ConfirmOptions {
  title: string;
  /** Optional body. Falls back to the title if not provided. */
  message?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Visual variant for the confirm button — defaults to destructive. */
  variant?: "destructive" | "default";
}

interface ConfirmState extends ConfirmOptions {
  resolve: (ok: boolean) => void;
}

export function useConfirm(): {
  confirm: (opts: ConfirmOptions) => Promise<boolean>;
  ConfirmDialog: () => ReactNode;
} {
  const [state, setState] = useState<ConfirmState | null>(null);
  const messageId = useId();
  const cancelButtonRef = useRef<HTMLButtonElement>(null);

  const confirm = useCallback((opts: ConfirmOptions): Promise<boolean> => {
    return new Promise<boolean>((resolve) => {
      setState({ ...opts, resolve });
    });
  }, []);

  const handleResolve = useCallback(
    (ok: boolean) => {
      if (!state) return;
      state.resolve(ok);
      setState(null);
    },
    [state]
  );

  const ConfirmDialogEl = useCallback(() => {
    if (!state) return null;
    const {
      title,
      message,
      confirmLabel = "Confirm",
      cancelLabel = "Cancel",
      variant = "destructive",
    } = state;
    const body = message ?? title;
    return (
      <Dialog
        open
        onClose={() => handleResolve(false)}
        title={title}
        role="alertdialog"
        describedBy={messageId}
        initialFocusRef={cancelButtonRef}
      >
        <div id={messageId} className="text-sm text-muted-foreground mb-4">
          {body}
        </div>
        <div className="flex justify-end gap-2">
          <Button
            ref={cancelButtonRef}
            variant="outline"
            onClick={() => handleResolve(false)}
          >
            {cancelLabel}
          </Button>
          <Button variant={variant} onClick={() => handleResolve(true)}>
            {confirmLabel}
          </Button>
        </div>
      </Dialog>
    );
  }, [state, handleResolve, messageId]);

  return { confirm, ConfirmDialog: ConfirmDialogEl };
}
