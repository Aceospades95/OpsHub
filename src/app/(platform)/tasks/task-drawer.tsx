"use client";

import { useEffect, useState, useTransition } from "react";
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
        className="fixed top-0 right-0 z-50 h-full w-full max-w-md bg-card border-l border-border shadow-xl flex flex-col"
        role="dialog"
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
            type="button"
            onClick={onClose}
            className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground"
            aria-label="Close"
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
              <p className="mt-1 text-xs text-amber-600" role="status">
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
