"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Dialog } from "@/components/ui/dialog";
import { assignToolToProject, removeToolFromProject } from "@/actions/tools";
import { Plus, X } from "lucide-react";
import Link from "next/link";

interface Props {
  toolProjects: { id: string; project: { id: string; name: string } }[];
  toolId: string;
  allProjects: { id: string; name: string }[];
  canEdit: boolean;
}

export function ToolProjectsSection({ toolProjects, toolId, allProjects, canEdit }: Props) {
  const [open, setOpen] = useState(false);
  const router = useRouter();

  const assignedIds = new Set(toolProjects.map((tp) => tp.project.id));
  const available = allProjects.filter((p) => !assignedIds.has(p.id));

  async function handleAssign(formData: FormData) {
    formData.set("toolId", toolId);
    await assignToolToProject(null, formData);
    setOpen(false);
    router.refresh();
  }

  async function handleRemove(id: string) {
    const fd = new FormData();
    fd.set("id", id);
    await removeToolFromProject(null, fd);
    router.refresh();
  }

  return (
    <div className="space-y-2">
      {toolProjects.length === 0 && <p className="text-sm text-muted-foreground">Not assigned to any projects</p>}
      {toolProjects.map((tp) => (
        <div key={tp.id} className="flex items-center justify-between rounded border border-border bg-muted/50 p-2">
          <Link href={`/projects/${tp.project.id}`} className="text-sm text-primary hover:underline">{tp.project.name}</Link>
          {canEdit && (
            <button onClick={() => handleRemove(tp.id)} className="text-muted-foreground hover:text-destructive">
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
      ))}
      {canEdit && (
        <>
          <Button variant="outline" size="sm" className="w-full" onClick={() => setOpen(true)}>
            <Plus className="h-4 w-4 mr-1" /> Assign to Project
          </Button>
          <Dialog open={open} onClose={() => setOpen(false)} title="Assign to Project">
            <form action={handleAssign} className="space-y-4">
              <Select name="projectId" label="Project" options={available.map(p => ({ label: p.name, value: p.id }))} placeholder="Select" required />
              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
                <Button type="submit">Assign</Button>
              </div>
            </form>
          </Dialog>
        </>
      )}
    </div>
  );
}
