"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { FormDialog } from "@/components/shared/form-dialog";
import { createProject } from "@/actions/projects";
import { Plus } from "lucide-react";

interface Props {
  clients: { id: string; name: string }[];
  projects?: { id: string; name: string }[];
  serviceOfferings?: { id: string; name: string }[];
  defaultClientId?: string;
  defaultParentId?: string;
}

export function ProjectCreateButton({ clients, projects, serviceOfferings, defaultClientId, defaultParentId }: Props) {
  const [open, setOpen] = useState(false);
  const [creatingNewClient, setCreatingNewClient] = useState(false);
  const [creatingNewOffering, setCreatingNewOffering] = useState(false);
  const [selectedRelated, setSelectedRelated] = useState<string[]>([]);

  const toggleRelated = (id: string) => {
    setSelectedRelated((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const handleClose = () => {
    setOpen(false);
    setCreatingNewClient(false);
    setCreatingNewOffering(false);
    setSelectedRelated([]);
  };

  return (
    <>
      <Button onClick={() => setOpen(true)} size="sm">
        <Plus className="h-4 w-4 mr-1" />
        {defaultParentId ? "New Sub-Project" : "New Project"}
      </Button>
      <FormDialog
        open={open}
        onClose={handleClose}
        title={defaultParentId ? "Create Sub-Project" : "Create Project"}
        action={createProject}
        submitLabel="Create Project"
      >
        {({ fieldErrors }) => (
          <>
            {defaultParentId && (
              <input type="hidden" name="parentProjectId" value={defaultParentId} />
            )}

            {/* Hidden inputs for related project IDs */}
            {selectedRelated.map((id) => (
              <input key={id} type="hidden" name="relatedProjectIds" value={id} />
            ))}

            <Input name="name" label="Project Name" required error={fieldErrors?.name?.[0]} />

            {/* Client: select existing or create new */}
            {creatingNewClient ? (
              <div>
                <Input name="newClientName" label="New Client Name" required />
                <button
                  type="button"
                  onClick={() => setCreatingNewClient(false)}
                  className="mt-1 text-xs text-primary hover:underline"
                >
                  Select existing client instead
                </button>
              </div>
            ) : (
              <div>
                <Select
                  name="clientId"
                  label="Client"
                  defaultValue={defaultClientId || ""}
                  options={clients.map((c) => ({ label: c.name, value: c.id }))}
                  placeholder="Select client"
                  required={!creatingNewClient}
                  error={fieldErrors?.clientId?.[0]}
                />
                <button
                  type="button"
                  onClick={() => setCreatingNewClient(true)}
                  className="mt-1 text-xs text-primary hover:underline"
                >
                  + Create new client
                </button>
              </div>
            )}

            <Textarea name="description" label="Description" />

            <div className="grid grid-cols-2 gap-4">
              <Select
                name="status"
                label="Status"
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
                      options={(serviceOfferings || []).map((so) => ({ label: so.name, value: so.id }))}
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
              <Input name="startDate" label="Start Date" type="date" />
              <Input name="endDate" label="End Date" type="date" />
            </div>

            {/* Parent Project selector (only when not already creating a sub-project) */}
            {!defaultParentId && projects && projects.length > 0 && (
              <Select
                name="parentProjectId"
                label="Parent Project"
                options={projects.map((p) => ({ label: p.name, value: p.id }))}
                placeholder="None (top-level project)"
              />
            )}

            {/* Related Projects */}
            {projects && projects.length > 0 && (
              <div className="space-y-1">
                <label className="block text-sm font-medium text-foreground">
                  Related Projects
                </label>
                <div className="max-h-36 overflow-y-auto rounded border border-input p-2 space-y-1">
                  {projects.map((p) => (
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
  );
}
