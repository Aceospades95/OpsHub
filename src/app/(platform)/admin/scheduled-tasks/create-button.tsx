"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { createScheduledTask } from "@/actions/scheduled-tasks";

import {
  EMPTY_TASK,
  TaskForm,
  stateToPayload,
  type ReportOption,
  type TaskFormState,
} from "./task-form";

interface Props {
  reports: ReportOption[];
}

export function ScheduledTaskCreateButton({ reports }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<TaskFormState>({ ...EMPTY_TASK });
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleCreate() {
    setError(null);
    if (!state.name.trim()) {
      setError("Name is required");
      return;
    }
    startTransition(async () => {
      const res = await createScheduledTask(stateToPayload(state));
      if ("error" in res) {
        setError(res.error ?? "Could not create task");
        return;
      }
      setOpen(false);
      setState({ ...EMPTY_TASK });
      router.refresh();
    });
  }

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4 mr-2" />
        New scheduled task
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="New scheduled task"
        className="max-w-xl"
      >
        <TaskForm state={state} onChange={setState} reports={reports} />
        {error && <p className="text-sm text-destructive mt-3">{error}</p>}
        <div className="flex justify-end gap-2 mt-4">
          <Button
            variant="outline"
            onClick={() => setOpen(false)}
            disabled={pending}
          >
            Cancel
          </Button>
          <Button onClick={handleCreate} disabled={pending}>
            {pending ? "Creating…" : "Create task"}
          </Button>
        </div>
      </Dialog>
    </>
  );
}
