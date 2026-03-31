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
  defaultClientId?: string;
  defaultParentId?: string;
}

export function ProjectCreateButton({ clients, defaultClientId, defaultParentId }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button onClick={() => setOpen(true)} size="sm">
        <Plus className="h-4 w-4 mr-1" />
        {defaultParentId ? "New Sub-Project" : "New Project"}
      </Button>
      <FormDialog
        open={open}
        onClose={() => setOpen(false)}
        title={defaultParentId ? "Create Sub-Project" : "Create Project"}
        action={createProject}
        submitLabel="Create Project"
      >
        {({ fieldErrors }) => (
          <>
            {defaultParentId && (
              <input type="hidden" name="parentProjectId" value={defaultParentId} />
            )}
            <Input name="name" label="Project Name" required error={fieldErrors?.name?.[0]} />
            <Select
              name="clientId"
              label="Client"
              defaultValue={defaultClientId || ""}
              options={clients.map((c) => ({ label: c.name, value: c.id }))}
              placeholder="Select client"
              required
            />
            <Textarea name="description" label="Description" />
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
            <div className="grid grid-cols-2 gap-4">
              <Input name="startDate" label="Start Date" type="date" />
              <Input name="endDate" label="End Date" type="date" />
            </div>
          </>
        )}
      </FormDialog>
    </>
  );
}
