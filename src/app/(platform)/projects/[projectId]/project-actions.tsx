"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { FormDialog } from "@/components/shared/form-dialog";
import { Dialog } from "@/components/ui/dialog";
import { updateProject, deleteProject } from "@/actions/projects";
import { Pencil, Trash2 } from "lucide-react";

interface Props {
  project: {
    id: string;
    name: string;
    description: string | null;
    status: string;
    startDate: Date | null;
    endDate: Date | null;
    clientId: string;
  };
  clients: { id: string; name: string }[];
  canEdit: boolean;
  canDelete: boolean;
}

export function ProjectActions({ project, clients, canEdit, canDelete }: Props) {
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const router = useRouter();

  async function handleDelete() {
    const fd = new FormData();
    fd.set("id", project.id);
    const result = await deleteProject(null, fd);
    if (result.success) router.push("/projects");
  }

  return (
    <div className="flex gap-2">
      {canEdit && (
        <>
          <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
            <Pencil className="h-4 w-4 mr-1" /> Edit
          </Button>
          <FormDialog open={editOpen} onClose={() => setEditOpen(false)} title="Edit Project" action={updateProject}>
            {({ fieldErrors }) => (
              <>
                <input type="hidden" name="id" value={project.id} />
                <Input name="name" label="Name" defaultValue={project.name} required error={fieldErrors?.name?.[0]} />
                <Select
                  name="clientId"
                  label="Client"
                  defaultValue={project.clientId}
                  options={clients.map((c) => ({ label: c.name, value: c.id }))}
                />
                <Textarea name="description" label="Description" defaultValue={project.description || ""} />
                <Select
                  name="status"
                  label="Status"
                  defaultValue={project.status}
                  options={[
                    { label: "Planning", value: "PLANNING" },
                    { label: "Active", value: "ACTIVE" },
                    { label: "On Hold", value: "ON_HOLD" },
                    { label: "Completed", value: "COMPLETED" },
                    { label: "Archived", value: "ARCHIVED" },
                  ]}
                />
                <div className="grid grid-cols-2 gap-4">
                  <Input name="startDate" label="Start Date" type="date" defaultValue={project.startDate?.toISOString().split("T")[0] || ""} />
                  <Input name="endDate" label="End Date" type="date" defaultValue={project.endDate?.toISOString().split("T")[0] || ""} />
                </div>
              </>
            )}
          </FormDialog>
        </>
      )}
      {canDelete && (
        <>
          <Button variant="destructive" size="sm" onClick={() => setDeleteOpen(true)}>
            <Trash2 className="h-4 w-4 mr-1" /> Delete
          </Button>
          <Dialog open={deleteOpen} onClose={() => setDeleteOpen(false)} title="Delete Project">
            <p className="text-sm text-muted-foreground mb-4">
              Are you sure you want to delete <strong>{project.name}</strong>?
              All sub-projects, milestones, and documents will be deleted.
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setDeleteOpen(false)}>Cancel</Button>
              <Button variant="destructive" onClick={handleDelete}>Delete</Button>
            </div>
          </Dialog>
        </>
      )}
    </div>
  );
}
