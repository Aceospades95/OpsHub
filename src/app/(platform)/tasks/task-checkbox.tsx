"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { updateTaskStatus } from "@/actions/tasks";
import { CheckSquare, Square, MinusSquare, Undo2 } from "lucide-react";

interface TaskCheckboxProps {
  taskId: string;
  status: string;
}

/**
 * Task-status checkbox with a 5-second Undo toast on transitions
 * INTO the DONE state. The QA stress test flagged that checking a
 * task off was a one-way street — there was no easy way to recover
 * from an accidental click without opening the task and toggling
 * the status field by hand. The undo toast hangs around for 5s,
 * fades out, and can be dismissed by clicking the row again or by
 * letting the timer expire.
 *
 * Reverting back to TODO doesn't trigger a toast — that path is
 * already a recovery action.
 */
export function TaskCheckbox({ taskId, status }: TaskCheckboxProps) {
  const [loading, setLoading] = useState(false);
  /** "from" = the status the row had before the click; non-null while
   *  the undo toast is on screen. */
  const [undoFrom, setUndoFrom] = useState<string | null>(null);
  const router = useRouter();

  // Auto-dismiss the toast after 5s. Clears any in-flight timer if
  // the user clicks somewhere else first.
  useEffect(() => {
    if (!undoFrom) return;
    const timer = setTimeout(() => setUndoFrom(null), 5000);
    return () => clearTimeout(timer);
  }, [undoFrom]);

  const handleToggle = async () => {
    setLoading(true);
    const newStatus = status === "DONE" ? "TODO" : "DONE";
    await updateTaskStatus(taskId, newStatus);
    if (newStatus === "DONE") {
      // Show the undo toast on completion only — un-checking is already
      // a recovery action.
      setUndoFrom(status);
    } else {
      setUndoFrom(null);
    }
    router.refresh();
    setLoading(false);
  };

  const handleUndo = async () => {
    if (!undoFrom) return;
    setLoading(true);
    await updateTaskStatus(taskId, undoFrom);
    setUndoFrom(null);
    router.refresh();
    setLoading(false);
  };

  const isDone = status === "DONE";
  const isCancelled = status === "CANCELLED";

  if (isCancelled) {
    return <MinusSquare className="h-5 w-5 text-muted-foreground shrink-0" />;
  }

  return (
    <>
      <button
        onClick={handleToggle}
        disabled={loading}
        className="shrink-0 hover:opacity-70 transition-opacity disabled:opacity-50"
        aria-label={isDone ? "Mark task as not done" : "Mark task as done"}
      >
        {isDone ? (
          <CheckSquare className="h-5 w-5 text-primary" />
        ) : (
          <Square className="h-5 w-5 text-muted-foreground" />
        )}
      </button>

      {undoFrom && (
        <div
          className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 rounded-lg bg-foreground px-4 py-2 text-sm text-background shadow-lg"
          role="status"
        >
          <span>Task marked done.</span>
          <button
            type="button"
            onClick={handleUndo}
            className="inline-flex items-center gap-1 font-medium underline-offset-2 hover:underline"
          >
            <Undo2 className="h-3.5 w-3.5" />
            Undo
          </button>
        </div>
      )}
    </>
  );
}
