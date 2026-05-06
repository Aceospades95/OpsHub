"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { FormDialog } from "@/components/shared/form-dialog";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
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
    serviceOfferingId: string | null;
  };
  clients: { id: string; name: string }[];
  serviceOfferings: { id: string; name: string }[];
  canEdit: boolean;
  canDelete: boolean;
}

export function ProjectActions({ project, clients, serviceOfferings, canEdit, canDelete }: Props) {
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [creatingNewOffering, setCreatingNewOffering] = useState(false);

  // Reset the "new offering" toggle when the edit dialog closes
  function handleCloseEdit() {
    setEditOpen(false);
    setCreatingNewOffering(false);
  }

  async function runDelete() {
    const fd = new FormData();
    fd.set("id", project.id);
    return deleteProject(null, fd);
  }

  return (
    <div className="flex gap-2">
      {canEdit && (
        <>
          <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
            <Pencil className="h-4 w-4 mr-1" /> Edit
          </Button>
          <FormDialog open={editOpen} onClose={handleCloseEdit} title="Edit Project" action={updateProject}>
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
                <div className="grid grid-cols-2 gap-4">
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
                  {/* Service Offering: select existing or create new inline */}
                  <div>
                    {creatingNewOffering ? (
                      <>
                        <Input
                          name="newServiceOfferingName"
                          label="New Service Offering"
                          placeholder="e.g. Cloud Migration"
                          required
                        />
                        <button
                          type="button"
                          onClick={() => setCreatingNewOffering(false)}
                          className="mt-1 text-xs text-primary hover:underline"
                        >
                          Select existing offering instead
                        </button>
                      </>
                    ) : (
                      <>
                        <Select
                          name="serviceOfferingId"
                          label="Service Offering"
                          defaultValue={project.serviceOfferingId || ""}
                          options={serviceOfferings.map((so) => ({ label: so.name, value: so.id }))}
                          placeholder="Select offering..."
                        />
                        <button
                          type="button"
                          onClick={() => setCreatingNewOffering(true)}
                          className="mt-1 text-xs text-primary hover:underline"
                        >
                          + Create new offering
                        </button>
                      </>
                    )}
                  </div>
                </div>
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
          <ConfirmDialog
            open={deleteOpen}
            onClose={() => setDeleteOpen(false)}
            title="Delete Project"
            message={
              <>
                Are you sure you want to delete <strong>{project.name}</strong>?
                Sub-projects, milestones, and project members will be deleted.
                Linked contracts, files, and tasks will be unassigned.
              </>
            }
            onConfirm={runDelete}
            navigateTo="/projects"
            confirmLabel="Delete"
          />
        </>
      )}
    </div>
  );
}
