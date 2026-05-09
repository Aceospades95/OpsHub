"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  MoreHorizontal,
  Pencil,
  PlayCircle,
  Power,
  PowerOff,
  Trash2,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { useConfirm } from "@/components/shared/use-confirm";
import {
  deleteScheduledTask,
  runScheduledTaskNow,
  toggleScheduledTaskActive,
  updateScheduledTask,
} from "@/actions/scheduled-tasks";
import type { ScheduledTaskFrequency, ScheduledTaskType } from "@prisma/client";

import {
  TaskForm,
  stateToPayload,
  type ReportOption,
  type TaskFormState,
} from "./task-form";

interface TaskRow {
  id: string;
  name: string;
  description: string | null;
  taskType: ScheduledTaskType;
  frequency: ScheduledTaskFrequency;
  hourUtc: number;
  dayOfWeek: number | null;
  dayOfMonth: number | null;
  config: Record<string, unknown>;
  isActive: boolean;
}

interface Props {
  task: TaskRow;
  reports: ReportOption[];
}

export function TaskRowActions({ task, reports }: Props) {
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const { confirm, ConfirmDialog } = useConfirm();

  function run<T>(fn: () => Promise<T>) {
    setError(null);
    setMenuOpen(false);
    startTransition(async () => {
      const res = (await fn()) as { error?: string } | { success: true };
      if ("error" in res && res.error) {
        setError(res.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <>
      <div className="relative inline-block">
        <Button
          variant="outline"
          size="icon"
          onClick={() => setMenuOpen((v) => !v)}
          aria-label="More actions"
          disabled={pending}
        >
          <MoreHorizontal className="h-4 w-4" />
        </Button>
        {menuOpen && (
          <>
            <div
              className="fixed inset-0 z-40"
              onClick={() => setMenuOpen(false)}
            />
            <div className="absolute right-0 mt-2 w-52 rounded border border-border bg-card shadow-lg z-50 py-1">
              <button
                onClick={() => run(() => runScheduledTaskNow(task.id))}
                disabled={pending}
                className="flex w-full items-center gap-2 px-3 py-2 text-sm hover:bg-muted text-left"
              >
                <PlayCircle className="h-4 w-4" />
                Run now
              </button>
              <button
                onClick={() => {
                  setMenuOpen(false);
                  setEditOpen(true);
                }}
                className="flex w-full items-center gap-2 px-3 py-2 text-sm hover:bg-muted text-left"
              >
                <Pencil className="h-4 w-4" />
                Edit
              </button>
              <button
                onClick={() =>
                  run(() => toggleScheduledTaskActive(task.id, !task.isActive))
                }
                disabled={pending}
                className="flex w-full items-center gap-2 px-3 py-2 text-sm hover:bg-muted text-left"
              >
                {task.isActive ? (
                  <>
                    <PowerOff className="h-4 w-4" />
                    Disable
                  </>
                ) : (
                  <>
                    <Power className="h-4 w-4" />
                    Enable
                  </>
                )}
              </button>
              <button
                onClick={async () => {
                  const ok = await confirm({
                    title: `Delete "${task.name}"?`,
                    confirmLabel: "Delete",
                  });
                  if (!ok) return;
                  run(() => deleteScheduledTask(task.id));
                }}
                disabled={pending}
                className="flex w-full items-center gap-2 px-3 py-2 text-sm hover:bg-muted text-left text-destructive"
              >
                <Trash2 className="h-4 w-4" />
                Delete
              </button>
            </div>
          </>
        )}
      </div>
      {error && (
        <p className="text-[10px] text-destructive mt-1 max-w-[14rem]">
          {error}
        </p>
      )}

      {editOpen && (
        <EditDialog
          task={task}
          reports={reports}
          onClose={(changed) => {
            setEditOpen(false);
            if (changed) router.refresh();
          }}
        />
      )}
      <ConfirmDialog />
    </>
  );
}

function EditDialog({
  task,
  reports,
  onClose,
}: {
  task: TaskRow;
  reports: ReportOption[];
  onClose: (changed: boolean) => void;
}) {
  const [state, setState] = useState<TaskFormState>(taskRowToState(task));
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleSave() {
    setError(null);
    if (!state.name.trim()) {
      setError("Name is required");
      return;
    }
    startTransition(async () => {
      const res = await updateScheduledTask({
        id: task.id,
        ...stateToPayload(state),
      });
      if ("error" in res) {
        setError(res.error ?? "Could not save");
        return;
      }
      onClose(true);
    });
  }

  return (
    <Dialog
      open
      onClose={() => onClose(false)}
      title={`Edit ${task.name}`}
      className="max-w-xl"
    >
      <TaskForm state={state} onChange={setState} reports={reports} />
      {error && <p className="text-sm text-destructive mt-3">{error}</p>}
      <div className="flex justify-end gap-2 mt-4">
        <Button
          variant="outline"
          onClick={() => onClose(false)}
          disabled={pending}
        >
          Cancel
        </Button>
        <Button onClick={handleSave} disabled={pending}>
          {pending ? "Saving…" : "Save"}
        </Button>
      </div>
    </Dialog>
  );
}

function taskRowToState(task: TaskRow): TaskFormState {
  const cfg = task.config;
  const joinList = (key: string) =>
    Array.isArray(cfg[key])
      ? (cfg[key] as unknown[]).map(String).join(", ")
      : typeof cfg[key] === "string"
        ? (cfg[key] as string)
        : "";
  return {
    name: task.name,
    description: task.description ?? "",
    taskType: task.taskType,
    frequency: task.frequency,
    hourUtc: task.hourUtc,
    dayOfWeek: task.dayOfWeek ?? 1,
    dayOfMonth: task.dayOfMonth ?? 1,
    isActive: task.isActive,
    reportKey: typeof cfg.reportKey === "string" ? cfg.reportKey : "",
    recipients: joinList("recipients"),
    cc: joinList("cc"),
    bcc: joinList("bcc"),
    replyTo: typeof cfg.replyTo === "string" ? cfg.replyTo : "",
    subject: typeof cfg.subject === "string" ? cfg.subject : "",
    body: typeof cfg.body === "string" ? cfg.body : "",
  };
}
