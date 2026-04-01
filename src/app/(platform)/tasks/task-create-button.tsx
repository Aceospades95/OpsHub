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

  useEffect(() => {
    if (state?.success) {
      setOpen(false);
      router.refresh();
    }
  }, [state, router]);

  return (
    <>
      <Button onClick={() => setOpen(true)} size="sm">
        <Plus className="h-4 w-4 mr-1" /> New Task
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Create Task">
        <form action={action} className="space-y-4">
          {state?.error && (
            <p className="text-sm text-destructive">{state.error}</p>
          )}
          <Input name="title" label="Title" required />
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
            <Input name="dueDate" label="Due Date" type="date" />
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
