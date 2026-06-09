"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { X, Save, ExternalLink } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { updateTask } from "@/actions/tasks";
import { toCalendarDateString } from "@/lib/dates";

/**
 * Side drawer that opens when a row on /tasks is clicked.
 *
 * The QA stress test flagged that:
 *   - Clicking a task row body did NOTHING — only the checkbox toggled
 *     status, leaving description content unreachable from the list.
 *   - Tasks have a `description` set at creation that's then invisible.
 *
 * The drawer wires through the existing `updateTask` action so the
 * permission gates and revalidation paths line up with the rest of
 * the task surface.
 */

export interface TaskDrawerTask {
  id: string;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  dueDate: Date | string | null;
  /** When the task was marked DONE/CANCELLED — surfaced in the
   *  list-row metadata for completed tasks so the row isn't a
   *  blank line where the due date used to be. */
  completedAt: Date | string | null;
  project: { id: string; name: string } | null;
  client: { id: string; name: string } | null;
  assignee: { id: string; name: string } | null;
}

interface Props {
  task: TaskDrawerTask | null;
  projects: { id: string; name: string }[];
  clients: { id: string; name: string }[];
  users: { id: string; name: string }[];
  onClose: () => void;
}

// Same focusable-elements selector the shared <Dialog> uses for its
// focus trap (R10-2). The drawer can't reuse <Dialog> directly — it's
// a centered max-w-lg modal, not a full-height side panel — so it
// mirrors the trap implementation instead.
const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "textarea:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

export function TaskDrawer({ task, projects, clients, users, onClose }: Props) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState("TODO");
  const [priority, setPriority] = useState("MEDIUM");
  const [dueDate, setDueDate] = useState("");
  const [projectId, setProjectId] = useState("");
  const [clientId, setClientId] = useState("");
  const [assigneeId, setAssigneeId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const panelRef = useRef<HTMLElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);
  const open = !!task;

  // Re-seed local state when the drawer opens for a different task.
  useEffect(() => {
    if (!task) return;
    setTitle(task.title);
    setDescription(task.description ?? "");
    setStatus(task.status);
    setPriority(task.priority);
    setDueDate(toCalendarDateString(task.dueDate));
    setProjectId(task.project?.id ?? "");
    setClientId(task.client?.id ?? "");
    setAssigneeId(task.assignee?.id ?? "");
    setError(null);
  }, [task]);

  // Focus management — mirror of the shared <Dialog>'s R10-2 behavior:
  // snapshot the trigger on open, move focus into the drawer, restore
  // focus to the trigger on close.
  useEffect(() => {
    if (!open) return;
    previouslyFocusedRef.current = document.activeElement as HTMLElement | null;
    const id = requestAnimationFrame(() => {
      closeButtonRef.current?.focus();
    });
    return () => {
      cancelAnimationFrame(id);
      const prev = previouslyFocusedRef.current;
      if (prev && document.contains(prev)) {
        prev.focus();
      }
    };
  }, [open]);

  // Escape closes; Tab cycles focus inside the panel (basic focus trap).
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
      );
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

  if (!task) return null;

  const todayStr = new Date().toISOString().slice(0, 10);
  const isPastDue = dueDate !== "" && dueDate < todayStr && status !== "DONE";

  function handleSave() {
    if (!task) return;
    setError(null);
    if (!title.trim()) {
      setError("Title is required");
      return;
    }

    const fd = new FormData();
    fd.set("taskId", task.id);
    fd.set("title", title.trim());
    fd.set("description", description.trim());
    fd.set("status", status);
    fd.set("priority", priority);
    fd.set("dueDate", dueDate);
    fd.set("projectId", projectId);
    fd.set("clientId", clientId);
    fd.set("assigneeId", assigneeId);

    startTransition(async () => {
      const res = await updateTask(null, fd);
      if (res && "error" in res && res.error) {
        setError(res.error);
        return;
      }
      onClose();
      router.refresh();
    });
  }

  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-black/30"
        onClick={onClose}
      />
      <aside
        ref={panelRef}
        className="fixed top-0 right-0 z-50 h-full w-full max-w-md bg-card border-l border-border shadow-xl flex flex-col"
        role="dialog"
        aria-modal="true"
        aria-label={`Edit task: ${task.title}`}
      >
        <header className="flex items-center justify-between px-4 py-3 border-b border-border">
          <div className="min-w-0">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              Edit task
            </p>
            <h2 className="text-lg font-semibold truncate">{task.title}</h2>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground"
            aria-label="Close task drawer"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          <Input
            label="Title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <Textarea
            label="Description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Add a description, link, or context for this task…"
            rows={5}
          />
          <div className="grid grid-cols-2 gap-3">
            <Select
              label="Status"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              options={[
                { label: "To Do", value: "TODO" },
                { label: "In Progress", value: "IN_PROGRESS" },
                { label: "Done", value: "DONE" },
                { label: "Cancelled", value: "CANCELLED" },
              ]}
            />
            <Select
              label="Priority"
              value={priority}
              onChange={(e) => setPriority(e.target.value)}
              options={[
                { label: "High", value: "HIGH" },
                { label: "Medium", value: "MEDIUM" },
                { label: "Low", value: "LOW" },
              ]}
            />
          </div>
          <div>
            <Input
              label="Due Date"
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
            />
            {isPastDue && (
              <p className="mt-1 text-xs text-warning" role="status">
                This due date is in the past — are you sure?
              </p>
            )}
          </div>
          <Select
            label="Assignee"
            value={assigneeId}
            onChange={(e) => setAssigneeId(e.target.value)}
            placeholder="Unassigned"
            options={users.map((u) => ({ label: u.name, value: u.id }))}
          />
          <div className="grid grid-cols-2 gap-3">
            <Select
              label="Project"
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
              placeholder="No project"
              options={projects.map((p) => ({ label: p.name, value: p.id }))}
            />
            <Select
              label="Client"
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              placeholder="No client"
              options={clients.map((c) => ({ label: c.name, value: c.id }))}
            />
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          {task.project && (
            <div className="pt-2 border-t border-border">
              <Link
                href={`/projects/${task.project.id}`}
                className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
              >
                <ExternalLink className="h-3 w-3" />
                Open project: {task.project.name}
              </Link>
            </div>
          )}
        </div>

        <footer className="px-4 py-3 border-t border-border flex justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={pending}>
            <Save className="h-4 w-4 mr-2" />
            {pending ? "Saving…" : "Save"}
          </Button>
        </footer>
      </aside>
    </>
  );
}
