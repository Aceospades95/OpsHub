"use client";

import { useState, useEffect } from "react";
import { useFormState } from "react-dom";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { createTask } from "@/actions/tasks";
import { Plus } from "lucide-react";

interface TaskCreateButtonProps {
  projects: { id: string; name: string }[];
  clients: { id: string; name: string }[];
  users: { id: string; name: string }[];
}

export function TaskCreateButton({ projects, clients, users }: TaskCreateButtonProps) {
  const [open, setOpen] = useState(false);
  const [state, action] = useFormState(createTask, null);
  const router = useRouter();
  const [dueDate, setDueDate] = useState("");

  useEffect(() => {
    if (state?.success) {
      setOpen(false);
      setDueDate("");
      router.refresh();
    }
  }, [state, router]);

  // Compare picked dueDate against today's calendar date — both as
  // YYYY-MM-DD strings so we never construct a Date object that would
  // shift across the viewer's timezone (see src/lib/dates.ts for the
  // longer write-up). The hint is informational, not blocking.
  const todayStr = new Date().toISOString().slice(0, 10);
  const isPastDue = dueDate !== "" && dueDate < todayStr;
  const titleError = state?.fieldErrors?.title?.[0] ?? state?.error?.includes("title")
    ? state?.fieldErrors?.title?.[0] ?? null
    : null;

  return (
    <>
      <Button onClick={() => setOpen(true)} size="sm">
        <Plus className="h-4 w-4 mr-1" /> New Task
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Create Task">
        <form action={action} className="space-y-4">
          {state?.error && !titleError && (
            <p className="text-sm text-destructive" role="alert">{state.error}</p>
          )}
          <Input
            name="title"
            label="Title"
            required
            error={titleError ?? undefined}
            aria-invalid={titleError ? true : undefined}
          />
          <Textarea name="description" label="Description" />
          <div className="grid grid-cols-2 gap-4">
            <Select
              name="priority"
              label="Priority"
              options={[
                { label: "High", value: "HIGH" },
                { label: "Medium", value: "MEDIUM" },
                { label: "Low", value: "LOW" },
              ]}
            />
            <div>
              <Input
                name="dueDate"
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
          </div>
          <Select
            name="assigneeId"
            label="Assignee"
            options={[
              { label: "Unassigned", value: "" },
              ...users.map((u) => ({ label: u.name, value: u.id })),
            ]}
          />
          <Select
            name="projectId"
            label="Project"
            options={[
              { label: "No project", value: "" },
              ...projects.map((p) => ({ label: p.name, value: p.id })),
            ]}
          />
          <Select
            name="clientId"
            label="Client"
            options={[
              { label: "No client", value: "" },
              ...clients.map((c) => ({ label: c.name, value: c.id })),
            ]}
          />
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <input type="checkbox" name="pushToGoogle" value="true" className="rounded" />
            Also add to the assignee&apos;s Google Tasks (needs them connected; a due date shows on
            their Google Calendar)
          </label>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit">Create Task</Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
