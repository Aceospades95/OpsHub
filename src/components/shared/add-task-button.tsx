"use client";

import { useEffect, useState } from "react";
import { useFormState } from "react-dom";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { GoogleListPicker } from "@/components/shared/google-list-picker";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { createTask } from "@/actions/tasks";
import { Plus } from "lucide-react";

/**
 * "Add task" from a parent entity's page — the project or client is
 * pre-filled (hidden inputs), so a task can be created without leaving
 * the page or re-picking the parent on /tasks. When projectId is set the
 * server derives the client from the project, so no client field shows.
 */
export function AddTaskButton({
  projectId,
  clientId,
  users,
}: {
  projectId?: string;
  clientId?: string;
  users: { id: string; name: string }[];
}) {
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
      <Button onClick={() => setOpen(true)} size="sm" variant="outline">
        <Plus className="h-4 w-4 mr-1" /> Add task
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Add task">
        <form action={action} className="space-y-4">
          {state?.error && (
            <p className="text-sm text-destructive" role="alert">
              {state.error}
            </p>
          )}
          {projectId && <input type="hidden" name="projectId" value={projectId} />}
          {!projectId && clientId && <input type="hidden" name="clientId" value={clientId} />}
          <Input name="title" label="Title" required maxLength={500} />
          <Textarea name="description" label="Description" />
          <div className="grid grid-cols-2 gap-4">
            <Select
              name="priority"
              label="Priority"
              defaultValue="MEDIUM"
              options={[
                { label: "High", value: "HIGH" },
                { label: "Medium", value: "MEDIUM" },
                { label: "Low", value: "LOW" },
              ]}
            />
            <Input name="dueDate" label="Due date" type="date" />
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
            name="visibility"
            label="Visibility"
            defaultValue="PUBLIC"
            options={[
              { label: "Public — visible under normal team rules", value: "PUBLIC" },
              { label: "Private — only you and the assignee", value: "PRIVATE" },
            ]}
          />
          {/* py-1 + h-5 checkbox keeps the label's hit area ≥24px tall —
              this toggle has an external side effect, so don't skimp. */}
          <label className="flex items-center gap-2 py-1 text-sm text-muted-foreground">
            <input type="checkbox" name="pushToGoogle" value="true" className="h-5 w-5 shrink-0 rounded" />
            Also add to the assignee&apos;s Google Tasks (needs them connected; a due date shows on their Google Calendar)
          </label>
          <GoogleListPicker />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit">Add task</Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
