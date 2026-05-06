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
    parentProjectId: string | null;
    /** Currently-linked related projects (id only, used to seed checkboxes). */
    relatedProjectIds: string[];
  };
  clients: { id: string; name: string }[];
  serviceOfferings: { id: string; name: string }[];
  /** Every project the user could possibly link as parent / related,
   *  excluding the project itself. */
  allProjects: { id: string; name: string }[];
  canEdit: boolean;
  canDelete: boolean;
}

export function ProjectActions({ project, clients, serviceOfferings, allProjects, canEdit, canDelete }: Props) {
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [creatingNewOffering, setCreatingNewOffering] = useState(false);
  // The Edit dialog gains parity with the Create dialog: parent project
  // and related projects are now editable here too. Seed from the
  // current state; reset on close so a cancelled edit doesn't leak the
  // pending selection into the next open.
  const [selectedRelated, setSelectedRelated] = useState<string[]>(
    project.relatedProjectIds
  );

  const toggleRelated = (id: string) => {
    setSelectedRelated((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  // Reset transient form state when the edit dialog closes
  function handleCloseEdit() {
    setEditOpen(false);
    setCreatingNewOffering(false);
    setSelectedRelated(project.relatedProjectIds);
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
                  <Input
                    name="startDate"
                    label="Start Date"
                    type="date"
                    defaultValue={project.startDate?.toISOString().split("T")[0] || ""}
                    error={fieldErrors?.startDate?.[0]}
                  />
                  <Input
                    name="endDate"
                    label="End Date"
                    type="date"
                    defaultValue={project.endDate?.toISOString().split("T")[0] || ""}
                    error={fieldErrors?.endDate?.[0]}
                  />
                </div>

                {/* Hidden inputs for related project IDs — submitted as
                 *  multiple `relatedProjectIds` form values, the server
                 *  action diffs them against the current set. */}
                {selectedRelated.map((id) => (
                  <input key={id} type="hidden" name="relatedProjectIds" value={id} />
                ))}

                {allProjects.length > 0 && (
                  <Select
                    name="parentProjectId"
                    label="Parent Project"
                    defaultValue={project.parentProjectId || ""}
                    options={allProjects.map((p) => ({ label: p.name, value: p.id }))}
                    placeholder="None (top-level project)"
                  />
                )}

                {allProjects.length > 0 && (
                  <div className="space-y-1">
                    <label className="block text-sm font-medium text-foreground">
                      Related Projects
                    </label>
                    <div className="max-h-36 overflow-y-auto rounded border border-input p-2 space-y-1">
                      {allProjects.map((p) => (
                        <label
                          key={p.id}
                          className="flex items-center gap-2 text-sm rounded px-1.5 py-1 hover:bg-muted cursor-pointer"
                        >
                          <input
                            type="checkbox"
                            checked={selectedRelated.includes(p.id)}
                            onChange={() => toggleRelated(p.id)}
                            className="rounded border-input"
                          />
                          <span className="truncate">{p.name}</span>
                        </label>
                      ))}
                    </div>
                    {selectedRelated.length > 0 && (
                      <p className="text-xs text-muted-foreground">
                        {selectedRelated.length} related {selectedRelated.length === 1 ? "project" : "projects"} selected
                      </p>
                    )}
                  </div>
                )}
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
