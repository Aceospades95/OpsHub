"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useFormState } from "react-dom";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { updateAssignment, deleteAssignment } from "@/actions/assignments";
import type { ProjectData, ClientData, ServiceOfferingData } from "./team-types";

export interface EditAssignmentData {
  id: string;
  employeeId: string;
  employeeName: string;
  projectId: string | null;
  clientId: string | null;
  serviceOfferingId: string | null;
  function: string;
  role: string;
  allocationFte: number;
  status: string;
  startDate: string | null;
  endDate: string | null;
  notes: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  assignment: EditAssignmentData | null;
  projects: ProjectData[];
  clients: ClientData[];
  serviceOfferings: ServiceOfferingData[];
}

export function EditAssignmentDialog({ open, onClose, assignment, projects, clients, serviceOfferings }: Props) {
  const [updateState, updateAction] = useFormState(updateAssignment, null);
  const [deleteState, deleteAction] = useFormState(deleteAssignment, null);
  const router = useRouter();
  const [selectedClient, setSelectedClient] = useState(assignment?.clientId || "");
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (assignment?.clientId) setSelectedClient(assignment.clientId);
  }, [assignment?.clientId]);

  useEffect(() => {
    if (updateState?.success || deleteState?.success) {
      onClose();
      router.refresh();
    }
  }, [updateState, deleteState, onClose, router]);

  const filteredProjects = selectedClient
    ? projects.filter((p) => p.clientId === selectedClient)
    : projects;

  if (!open || !assignment) return null;

  return (
    <Dialog open={open} onClose={onClose} title="Edit Assignment" className="max-w-xl">
      {updateState?.error && (
        <div className="mb-4 rounded bg-destructive/10 p-3 text-sm text-destructive">
          {updateState.error}
        </div>
      )}
      {deleteState?.error && (
        <div className="mb-4 rounded bg-destructive/10 p-3 text-sm text-destructive">
          {deleteState.error}
        </div>
      )}
      <form action={updateAction} className="space-y-4">
        <input type="hidden" name="id" value={assignment.id} />

        {/* Employee (read-only display) */}
        <div className="space-y-1">
          <label className="block text-sm font-medium">Employee</label>
          <input type="hidden" name="employeeId" value={assignment.employeeId} />
          <div className="w-full h-10 rounded border border-input bg-muted/50 px-3 py-2 text-sm flex items-center">
            {assignment.employeeName}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          {/* Service Offering */}
          <div className="space-y-1">
            <label className="block text-sm font-medium">Service Offering</label>
            <select name="serviceOfferingId" defaultValue={assignment.serviceOfferingId || ""}
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
            <input name="function" defaultValue={assignment.function} placeholder="e.g. Development, QA, PM"
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
            <select name="projectId" defaultValue={assignment.projectId || ""}
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
            <input name="role" defaultValue={assignment.role} placeholder="e.g. Lead, Technician"
              className="w-full h-10 rounded border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary" />
          </div>

          {/* FTE */}
          <div className="space-y-1">
            <label className="block text-sm font-medium">FTE Allocation *</label>
            <input name="allocationFte" type="number" step="0.05" min="0" max="2" defaultValue={assignment.allocationFte} required
              className="w-full h-10 rounded border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary" />
          </div>

          {/* Status */}
          <div className="space-y-1">
            <label className="block text-sm font-medium">Status</label>
            <select name="status" defaultValue={assignment.status}
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
            <input name="startDate" type="date" defaultValue={assignment.startDate || ""}
              className="w-full h-10 rounded border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary" />
          </div>

          {/* End Date */}
          <div className="space-y-1">
            <label className="block text-sm font-medium">End Date</label>
            <input name="endDate" type="date" defaultValue={assignment.endDate || ""}
              className="w-full h-10 rounded border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary" />
          </div>
        </div>

        {/* Notes */}
        <div className="space-y-1">
          <label className="block text-sm font-medium">Notes</label>
          <textarea name="notes" rows={2} defaultValue={assignment.notes} placeholder="Additional notes about this assignment..."
            className="w-full rounded border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary" />
        </div>

        <div className="flex justify-between pt-2">
          <div>
            {!confirmDelete ? (
              <Button type="button" variant="outline" className="text-destructive border-destructive/30 hover:bg-destructive/10"
                onClick={() => setConfirmDelete(true)}>
                Delete
              </Button>
            ) : (
              <form action={deleteAction} className="inline">
                <input type="hidden" name="id" value={assignment.id} />
                <div className="flex items-center gap-2">
                  <Button type="submit" variant="destructive" size="sm">Confirm Delete</Button>
                  <Button type="button" variant="outline" size="sm" onClick={() => setConfirmDelete(false)}>Cancel</Button>
                </div>
              </form>
            )}
          </div>
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit">Save Changes</Button>
          </div>
        </div>
      </form>
    </Dialog>
  );
}
