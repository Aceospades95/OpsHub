"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useFormState } from "react-dom";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { createAssignment } from "@/actions/assignments";
import type { UserData, ProjectData, ClientData, ServiceOfferingData } from "./team-types";

interface Props {
  open: boolean;
  onClose: () => void;
  users: UserData[];
  projects: ProjectData[];
  clients: ClientData[];
  serviceOfferings: ServiceOfferingData[];
  defaultEmployeeId?: string;
  defaultProjectId?: string;
  defaultClientId?: string;
  defaultServiceOfferingId?: string;
}

export function AddAssignmentDialog({ open, onClose, users, projects, clients, serviceOfferings, defaultEmployeeId, defaultProjectId, defaultClientId, defaultServiceOfferingId }: Props) {
  const [state, action] = useFormState(createAssignment, null);
  const router = useRouter();
  const [selectedClient, setSelectedClient] = useState(defaultClientId || "");

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

  if (!open) return null;

  return (
    <Dialog open={open} onClose={onClose} title="Add Assignment" className="max-w-xl">
      {state?.error && (
        <div className="mb-4 rounded bg-destructive/10 p-3 text-sm text-destructive">
          {state.error}
        </div>
      )}
      <form action={action} className="space-y-4">
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
          {/* Service Offering */}
          <div className="space-y-1">
            <label className="block text-sm font-medium">Service Offering</label>
            <select name="serviceOfferingId" defaultValue={defaultServiceOfferingId || ""}
              className="w-full h-10 rounded border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary">
              <option value="">None</option>
              {serviceOfferings.map((so) => (
                <option key={so.id} value={so.id}>{so.name}</option>
              ))}
            </select>
          </div>

          {/* Function */}
          <div className="space-y-1">
            <label className="block text-sm font-medium">Function / Work Type</label>
            <input name="function" placeholder="e.g. Development, QA, PM"
              className="w-full h-10 rounded border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary" />
          </div>
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
            <select name="projectId" defaultValue={defaultProjectId || ""}
              className="w-full h-10 rounded border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary">
              <option value="">None</option>
              {filteredProjects.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3">
          {/* Role */}
          <div className="space-y-1">
            <label className="block text-sm font-medium">Role</label>
            <input name="role" placeholder="e.g. Lead, Technician"
              className="w-full h-10 rounded border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary" />
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
          {/* Start Date */}
          <div className="space-y-1">
            <label className="block text-sm font-medium">Start Date</label>
            <input name="startDate" type="date"
              className="w-full h-10 rounded border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary" />
          </div>

          {/* End Date */}
          <div className="space-y-1">
            <label className="block text-sm font-medium">End Date</label>
            <input name="endDate" type="date"
              className="w-full h-10 rounded border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary" />
          </div>
        </div>

        {/* Notes */}
        <div className="space-y-1">
          <label className="block text-sm font-medium">Notes</label>
          <textarea name="notes" rows={2} placeholder="Additional notes about this assignment..."
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
