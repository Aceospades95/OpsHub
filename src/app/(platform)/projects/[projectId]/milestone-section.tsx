"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Avatar } from "@/components/ui/avatar";
import { Dialog } from "@/components/ui/dialog";
import { Select } from "@/components/ui/select";
import { FormDialog } from "@/components/shared/form-dialog";
import { useConfirm } from "@/components/shared/use-confirm";
import {
  createMilestone,
  toggleMilestone,
  deleteMilestone,
  addMilestoneAssignee,
  removeMilestoneAssignee,
} from "@/actions/projects";
import { Plus, Trash2, CheckCircle2, Circle, UserPlus, X } from "lucide-react";
import { formatCalendarDate } from "@/lib/dates";

interface Assignee {
  id: string;
  user: { id: string; name: string };
}

interface MilestoneData {
  id: string;
  title: string;
  description: string | null;
  dueDate: Date | null;
  completed: boolean;
  completedAt: Date | null;
  assignees: Assignee[];
}

interface Props {
  milestones: MilestoneData[];
  projectId: string;
  allUsers: { id: string; name: string; email: string }[];
  canEdit: boolean;
  canCreate: boolean;
  canDelete: boolean;
}

export function MilestoneSection({ milestones, projectId, allUsers, canEdit, canCreate, canDelete }: Props) {
  const [createOpen, setCreateOpen] = useState(false);
  const [assignOpen, setAssignOpen] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const { confirm, ConfirmDialog } = useConfirm();
  const router = useRouter();

  function handleToggle(id: string) {
    startTransition(async () => {
      const fd = new FormData();
      fd.set("id", id);
      const result = await toggleMilestone(null, fd);
      if (result && "error" in result && result.error) {
        toast.error(result.error);
        return;
      }
      router.refresh();
    });
  }

  async function handleDeleteMilestone(id: string, title: string) {
    const ok = await confirm({
      title: "Delete this milestone?",
      message: `"${title}" and its assignee list will be permanently removed.`,
      confirmLabel: "Delete",
    });
    if (!ok) return;
    startTransition(async () => {
      const fd = new FormData();
      fd.set("id", id);
      const result = await deleteMilestone(null, fd);
      if (result && "error" in result && result.error) {
        toast.error(result.error);
        return;
      }
      toast.success("Milestone deleted");
      router.refresh();
    });
  }

  async function handleAssign(formData: FormData) {
    const result = await addMilestoneAssignee(null, formData);
    if (result && "error" in result && result.error) {
      toast.error(result.error);
      return;
    }
    setAssignOpen(null);
    router.refresh();
  }

  async function handleUnassign(id: string, userName: string) {
    const ok = await confirm({
      title: `Remove ${userName} from this milestone?`,
      confirmLabel: "Remove",
    });
    if (!ok) return;
    startTransition(async () => {
      const fd = new FormData();
      fd.set("id", id);
      const result = await removeMilestoneAssignee(null, fd);
      if (result && "error" in result && result.error) {
        toast.error(result.error);
        return;
      }
      toast.success("Assignee removed");
      router.refresh();
    });
  }

  return (
    <div className="space-y-3">
      {milestones.length === 0 && (
        <p className="text-sm text-muted-foreground">No milestones</p>
      )}

      {milestones.map((ms) => (
        <div key={ms.id} className={`rounded border border-border bg-muted p-3 ${ms.completed ? "opacity-60" : ""}`}>
          <div className="flex items-start gap-3">
            {canEdit ? (
              <button
                onClick={() => handleToggle(ms.id)}
                disabled={isPending}
                aria-label={
                  ms.completed
                    ? `Mark milestone "${ms.title}" as incomplete`
                    : `Mark milestone "${ms.title}" as complete`
                }
                className="mt-0.5 disabled:opacity-50"
              >
                {ms.completed ? (
                  <CheckCircle2 className="h-5 w-5 text-success" />
                ) : (
                  <Circle className="h-5 w-5 text-muted-foreground" />
                )}
              </button>
            ) : ms.completed ? (
              <CheckCircle2 className="h-5 w-5 text-success mt-0.5" />
            ) : (
              <Circle className="h-5 w-5 text-muted-foreground mt-0.5" />
            )}
            <div className="flex-1 min-w-0">
              <p className={`text-sm font-medium ${ms.completed ? "line-through" : ""}`}>{ms.title}</p>
              {ms.description && (
                <p className="text-xs text-muted-foreground mt-0.5">{ms.description}</p>
              )}
              <div className="flex items-center gap-3 mt-2">
                {ms.dueDate && (
                  <span className="text-xs text-muted-foreground">
                    Due {formatCalendarDate(ms.dueDate, "MMM d, yyyy")}
                  </span>
                )}
                <div className="flex items-center gap-1">
                  {ms.assignees.map((a) => (
                    <div key={a.id} className="flex items-center gap-1">
                      <Link href={`/team/${a.user.id}`} title={a.user.name} className="hover:opacity-80">
                        <Avatar name={a.user.name} size="xs" />
                      </Link>
                      {canEdit && (
                        <button
                          onClick={() => handleUnassign(a.id, a.user.name)}
                          disabled={isPending}
                          aria-label={`Remove ${a.user.name} from milestone "${ms.title}"`}
                          className="text-muted-foreground hover:text-destructive disabled:opacity-50"
                        >
                          <X className="h-2.5 w-2.5" />
                        </button>
                      )}
                    </div>
                  ))}
                  {canEdit && (
                    <button
                      onClick={() => setAssignOpen(ms.id)}
                      aria-label={`Assign a user to milestone "${ms.title}"`}
                      className="rounded p-0.5 text-muted-foreground hover:text-primary"
                    >
                      <UserPlus className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              </div>
            </div>
            {canDelete && (
              <button
                onClick={() => handleDeleteMilestone(ms.id, ms.title)}
                disabled={isPending}
                aria-label={`Delete milestone "${ms.title}"`}
                className="text-muted-foreground hover:text-destructive disabled:opacity-50"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>
      ))}

      {canCreate && (
        <>
          <Button variant="outline" size="sm" className="w-full" onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4 mr-1" /> Add Milestone
          </Button>
          <FormDialog
            open={createOpen}
            onClose={() => setCreateOpen(false)}
            title="Create Milestone"
            action={createMilestone}
          >
            {({ fieldErrors }) => (
              <>
                <input type="hidden" name="projectId" value={projectId} />
                <Input name="title" label="Title" required error={fieldErrors?.title?.[0]} />
                <Textarea name="description" label="Description" />
                <Input name="dueDate" label="Due Date" type="date" />
              </>
            )}
          </FormDialog>
        </>
      )}

      {assignOpen && (
        <Dialog open={!!assignOpen} onClose={() => setAssignOpen(null)} title="Assign User">
          <form action={handleAssign} className="space-y-4">
            <input type="hidden" name="milestoneId" value={assignOpen} />
            <Select
              name="userId"
              label="User"
              options={allUsers.map((u) => ({ label: u.name, value: u.id }))}
              placeholder="Select user"
              required
            />
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setAssignOpen(null)}>Cancel</Button>
              <Button type="submit">Assign</Button>
            </div>
          </form>
        </Dialog>
      )}
      <ConfirmDialog />
    </div>
  );
}
