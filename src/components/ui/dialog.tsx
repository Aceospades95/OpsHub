"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { X } from "lucide-react";

interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  /**
   * Optional sticky footer (typically the action buttons row).
   * When supplied, the body becomes the only scrollable region —
   * the header and footer stay pinned. Round-6 QA: without this
   * the create-page modal at >930px content + 920px viewport
   * scrolled the WHOLE panel and the Cancel/Save buttons ended
   * up clipped below the viewport edge.
   */
  footer?: ReactNode;
  className?: string;
  /**
   * "alertdialog" forces the user to acknowledge the content before
   * the workflow continues — meant for destructive confirmations.
   * Defaults to "dialog". Round-10 QA: the project-delete modal
   * was a plain <div> with no role; screen readers couldn't tell
   * it was a confirmation. ConfirmDialog now passes
   * role="alertdialog".
   */
  role?: "dialog" | "alertdialog";
  /**
   * id of the element that names the dialog body. The Dialog wires
   * its own title heading; this prop lets callers point at a
   * separate description region (recommended for alertdialog so
   * SR users hear both the heading and the explanation when the
   * dialog opens).
   */
  describedBy?: string;
  /**
   * Ref to the element that should receive focus when the dialog
   * opens. ConfirmDialog uses this to focus the destructive button
   * on alertdialogs so a keyboard user lands on the action they're
   * about to take. Defaults to the close (X) button.
   */
  initialFocusRef?: React.RefObject<HTMLElement | null>;
}

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "textarea:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

export function Dialog({
  open,
  onClose,
  title,
  children,
  footer,
  className = "",
  role = "dialog",
  describedBy,
  initialFocusRef,
}: DialogProps) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);
  const titleId = useId();

  useEffect(() => {
    if (open) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  // Focus management: snapshot the active element on open, focus the
  // requested initial target (or the close button), restore focus on
  // close. Round-10 QA: the project-delete dialog used to leave focus
  // floating in the body — keyboard users had to tab from the
  // beginning to reach the destructive button.
  useEffect(() => {
    if (!open) return;
    previouslyFocusedRef.current = document.activeElement as HTMLElement | null;
    // Defer one tick so the panel has mounted before we focus.
    const id = requestAnimationFrame(() => {
      const target = initialFocusRef?.current ?? closeButtonRef.current;
      target?.focus();
    });
    return () => {
      cancelAnimationFrame(id);
      // Return focus to the trigger only if it's still in the DOM.
      const prev = previouslyFocusedRef.current;
      if (prev && document.contains(prev)) {
        prev.focus();
      }
    };
  }, [open, initialFocusRef]);

  // Escape closes; Tab cycles focus inside the panel (basic focus
  // trap — covers the keyboard-only case the WCAG audit flagged).
  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== "Tab") return;
      const panel = panelRef.current;
      if (!panel) return;
      const focusable = Array.from(
        panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
      ).filter((el) => !el.hasAttribute("data-focus-trap-skip"));
      if (focusable.length === 0) {
        e.preventDefault();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey) {
        if (active === first || !panel.contains(active)) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (active === last || !panel.contains(active)) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={(e) => {
        if (e.target === overlayRef.current) onClose();
      }}
    >
      <div
        ref={panelRef}
        role={role}
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={describedBy}
        className={`relative flex w-full max-w-lg max-h-[85vh] flex-col rounded bg-card border border-border shadow-lg ${className}`}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-border p-4">
          <h2 id={titleId} className="text-lg font-semibold">{title}</h2>
          <button
            ref={closeButtonRef}
            onClick={onClose}
            aria-label="Close dialog"
            title="Close dialog"
            className="rounded p-1 hover:bg-muted transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4">{children}</div>
        {footer && (
          <div className="shrink-0 border-t border-border bg-card p-4">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
