"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Avatar } from "@/components/ui/avatar";
import { Dialog } from "@/components/ui/dialog";
import { Select } from "@/components/ui/select";
import { FormDialog } from "@/components/shared/form-dialog";
import {
  createMilestone,
  toggleMilestone,
  deleteMilestone,
  addMilestoneAssignee,
  removeMilestoneAssignee,
} from "@/actions/projects";
import { Plus, Trash2, CheckCircle2, Circle, UserPlus, X } from "lucide-react";
import { format } from "date-fns";

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
  const router = useRouter();

  async function handleToggle(id: string) {
    const fd = new FormData();
    fd.set("id", id);
    await toggleMilestone(null, fd);
    router.refresh();
  }

  async function handleDeleteMilestone(id: string) {
    const fd = new FormData();
    fd.set("id", id);
    await deleteMilestone(null, fd);
    router.refresh();
  }

  async function handleAssign(formData: FormData) {
    await addMilestoneAssignee(null, formData);
    setAssignOpen(null);
    router.refresh();
  }

  async function handleUnassign(id: string) {
    const fd = new FormData();
    fd.set("id", id);
    await removeMilestoneAssignee(null, fd);
    router.refresh();
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
              <button onClick={() => handleToggle(ms.id)} className="mt-0.5">
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
                    Due {format(ms.dueDate, "MMM d, yyyy")}
                  </span>
                )}
                <div className="flex items-center gap-1">
                  {ms.assignees.map((a) => (
                    <div key={a.id} className="flex items-center gap-1">
                      <Link href={`/team/${a.user.id}`} title={a.user.name} className="hover:opacity-80">
                        <Avatar name={a.user.name} size="xs" />
                      </Link>
                      {canEdit && (
                        <button onClick={() => handleUnassign(a.id)} className="text-muted-foreground hover:text-destructive">
                          <X className="h-2.5 w-2.5" />
                        </button>
                      )}
                    </div>
                  ))}
                  {canEdit && (
                    <button
                      onClick={() => setAssignOpen(ms.id)}
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
                onClick={() => handleDeleteMilestone(ms.id)}
                className="text-muted-foreground hover:text-destructive"
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
    </div>
  );
}
