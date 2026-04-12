"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useFormState } from "react-dom";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { createAssignment, createRoleDefinition } from "@/actions/assignments";
import type { UserData, ProjectData, ClientData, ServiceOfferingData, RoleDefinitionData } from "./team-types";

interface Props {
  open: boolean;
  onClose: () => void;
  users: UserData[];
  projects: ProjectData[];
  clients: ClientData[];
  serviceOfferings: ServiceOfferingData[];
  roleDefinitions: RoleDefinitionData[];
  defaultEmployeeId?: string;
  defaultProjectId?: string;
  defaultClientId?: string;
  defaultServiceOfferingId?: string;
  defaultProjectRoleId?: string;
  defaultRoleName?: string;
  defaultRoleDefinitionId?: string;
}

export function AddAssignmentDialog({
  open, onClose, users, projects, clients, serviceOfferings, roleDefinitions,
  defaultEmployeeId, defaultProjectId, defaultClientId,
  defaultProjectRoleId, defaultRoleName, defaultRoleDefinitionId,
}: Props) {
  const [state, action] = useFormState(createAssignment, null);
  const router = useRouter();
  const [selectedClient, setSelectedClient] = useState(defaultClientId || "");
  const [selectedProject, setSelectedProject] = useState(defaultProjectId || "");
  const [roleMode, setRoleMode] = useState<"select" | "new">("select");
  const [newRoleName, setNewRoleName] = useState("");
  const [selectedRoleDefId, setSelectedRoleDefId] = useState(defaultRoleDefinitionId || "");

  useEffect(() => {
    if (state?.success) {
      onClose();
      router.refresh();
    }
  }, [state, onClose, router]);

  // Filter projects by selected client
  const filteredProjects = selectedClient
    ? projects.filter((p) => p.clientId === selectedClient)
    : projects;

  // Get the selected project's offering
  const selectedProjectData = projects.find((p) => p.id === selectedProject);
  const projectOffering = selectedProjectData?.serviceOffering?.name;

  // Auto-set client when project is selected
  const handleProjectChange = (projectId: string) => {
    setSelectedProject(projectId);
    if (projectId) {
      const proj = projects.find((p) => p.id === projectId);
      if (proj?.clientId) setSelectedClient(proj.clientId);
    }
  };

  const handleRoleSelect = (value: string) => {
    if (value === "__new__") {
      setRoleMode("new");
      setSelectedRoleDefId("");
    } else {
      setRoleMode("select");
      setSelectedRoleDefId(value);
    }
  };

  // Handle form submit - inject role fields
  const handleSubmit = async (formData: FormData) => {
    // Handle new role creation
    let roleDefId = selectedRoleDefId;
    if (roleMode === "new" && newRoleName.trim()) {
      const result = await createRoleDefinition(newRoleName.trim());
      if (result.id) {
        roleDefId = result.id;
        formData.set("role", newRoleName.trim());
      }
    } else if (roleDefId) {
      const rd = roleDefinitions.find((r) => r.id === roleDefId);
      if (rd) formData.set("role", rd.name);
    } else if (defaultRoleName) {
      formData.set("role", defaultRoleName);
    }

    if (roleDefId) formData.set("roleDefinitionId", roleDefId);
    if (defaultProjectRoleId) formData.set("projectRoleId", defaultProjectRoleId);

    // Set serviceOfferingId from project
    if (selectedProjectData?.serviceOfferingId) {
      formData.set("serviceOfferingId", selectedProjectData.serviceOfferingId);
    }

    action(formData);
  };

  if (!open) return null;

  return (
    <Dialog open={open} onClose={onClose} title="Add Assignment" className="max-w-xl">
      {state?.error && (
        <div className="mb-4 rounded bg-destructive/10 p-3 text-sm text-destructive">
          {state.error}
        </div>
      )}
      <form action={handleSubmit} className="space-y-4">
        {/* Employee */}
        <div className="space-y-1">
          <label className="block text-sm font-medium">Employee *</label>
          <select name="employeeId" required defaultValue={defaultEmployeeId || ""}
            className="w-full h-10 rounded border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary">
            <option value="">Select employee...</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>{u.name}{u.jobTitle ? ` — ${u.jobTitle}` : ""}</option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-2 gap-3">
          {/* Client */}
          <div className="space-y-1">
            <label className="block text-sm font-medium">Client</label>
            <select name="clientId" value={selectedClient} onChange={(e) => setSelectedClient(e.target.value)}
              className="w-full h-10 rounded border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary">
              <option value="">None</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>

          {/* Project */}
          <div className="space-y-1">
            <label className="block text-sm font-medium">Project</label>
            <select name="projectId" value={selectedProject} onChange={(e) => handleProjectChange(e.target.value)}
              className="w-full h-10 rounded border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary">
              <option value="">None</option>
              {filteredProjects.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Offering info (from project) */}
        {projectOffering && (
          <div className="text-xs text-muted-foreground bg-muted/50 rounded px-3 py-1.5">
            Offering: <span className="font-medium text-foreground">{projectOffering}</span> (from project)
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {/* Role */}
          <div className="space-y-1">
            <label className="block text-sm font-medium">Role {defaultRoleName && `(${defaultRoleName})`}</label>
            {roleMode === "select" ? (
              <select value={selectedRoleDefId} onChange={(e) => handleRoleSelect(e.target.value)}
                className="w-full h-10 rounded border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary">
                <option value="">{defaultRoleName ? defaultRoleName : "Select role..."}</option>
                {roleDefinitions.map((rd) => (
                  <option key={rd.id} value={rd.id}>{rd.name}</option>
                ))}
                <option value="__new__">+ Add new role...</option>
              </select>
            ) : (
              <div className="flex gap-1">
                <input
                  value={newRoleName}
                  onChange={(e) => setNewRoleName(e.target.value)}
                  placeholder="New role name"
                  className="w-full h-10 rounded border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                />
                <button type="button" onClick={() => { setRoleMode("select"); setNewRoleName(""); }}
                  className="px-2 h-10 rounded border border-input hover:bg-muted text-xs shrink-0">Back</button>
              </div>
            )}
          </div>

          {/* FTE */}
          <div className="space-y-1">
            <label className="block text-sm font-medium">FTE Allocation *</label>
            <input name="allocationFte" type="number" step="0.05" min="0" max="2" defaultValue="1.0" required
              className="w-full h-10 rounded border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary" />
          </div>

          {/* Status */}
          <div className="space-y-1">
            <label className="block text-sm font-medium">Status</label>
            <select name="status" defaultValue="ACTIVE"
              className="w-full h-10 rounded border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary">
              <option value="ACTIVE">Active</option>
              <option value="PLANNED">Planned</option>
              <option value="ON_HOLD">On Hold</option>
              <option value="COMPLETED">Completed</option>
            </select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className="block text-sm font-medium">Start Date</label>
            <input name="startDate" type="date"
              className="w-full h-10 rounded border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary" />
          </div>
          <div className="space-y-1">
            <label className="block text-sm font-medium">End Date</label>
            <input name="endDate" type="date"
              className="w-full h-10 rounded border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary" />
          </div>
        </div>

        {/* Notes */}
        <div className="space-y-1">
          <label className="block text-sm font-medium">Notes</label>
          <textarea name="notes" rows={2} placeholder="Additional notes..."
            className="w-full rounded border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary" />
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="submit">Create Assignment</Button>
        </div>
      </form>
    </Dialog>
  );
}
