"use client";

import { useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Plus, X, UserPlus, AlertTriangle, MapPin } from "lucide-react";
import Link from "next/link";
import {
  removeAssignment,
  quickAssign,
  createProjectRole,
  createRoleDefinition,
  deleteProjectRole,
  updateAssignmentFte,
  updateAssignmentRole,
} from "@/actions/assignments";

interface Assignment {
  id: string;
  allocationFte: number;
  status: string;
  role: string | null;
  notes: string | null;
  projectRoleId: string | null;
  employee: { id: string; name: string; jobTitle: string | null; location: string | null };
  roleDefinition: { id: string; name: string } | null;
  projectRole: { id: string; roleDefinition: { id: string; name: string }; requiredFte: number; quantity: number } | null;
  serviceOffering: { id: string; name: string } | null;
}

interface ProjectRole {
  id: string;
  requiredFte: number;
  quantity: number;
  roleDefinition: { id: string; name: string };
  assignments: { id: string; employeeId: string }[];
}

interface Props {
  projectId: string;
  projectName: string;
  clientId: string | null;
  serviceOfferingId: string | null;
  assignments: Assignment[];
  projectRoles: ProjectRole[];
  roleDefinitions: { id: string; name: string }[];
  allUsers: { id: string; name: string; jobTitle: string | null; location: string | null }[];
  canEdit: boolean;
}

export function ProjectStaffingSection({
  projectId, clientId, serviceOfferingId,
  assignments, projectRoles, roleDefinitions, allUsers, canEdit,
}: Props) {
  const [isPending, startTransition] = useTransition();
  const [addRoleOpen, setAddRoleOpen] = useState(false);
  const [addRoleForm, setAddRoleForm] = useState({ roleDefinitionId: "", newRoleName: "", requiredFte: "1", quantity: "1" });
  const [quickAssignCtx, setQuickAssignCtx] = useState<{
    projectRoleId?: string;
    roleDefinitionId?: string;
    roleName?: string;
    requiredFte: number;
  } | null>(null);
  const [editingFte, setEditingFte] = useState<{ assignmentId: string; value: string } | null>(null);
  const [editingRole, setEditingRole] = useState<string | null>(null);

  // Group assignments by role (matching project-role first, then by role name)
  type RoleGroup = {
    projectRoleId: string | null;
    roleName: string;
    requiredFte: number;
    requiredQuantity: number;
    assignments: Assignment[];
    filledCount: number;
    unfilledCount: number;
  };

  const roleGroups: RoleGroup[] = [];
  const usedAssignmentIds = new Set<string>();

  // 1) Groups from defined ProjectRoles
  for (const pr of projectRoles) {
    const matching = assignments.filter((a) =>
      (a.projectRoleId && a.projectRoleId === pr.id) ||
      (!a.projectRoleId && a.roleDefinition?.id === pr.roleDefinition.id)
    );
    matching.forEach((a) => usedAssignmentIds.add(a.id));
    roleGroups.push({
      projectRoleId: pr.id,
      roleName: pr.roleDefinition.name,
      requiredFte: pr.requiredFte,
      requiredQuantity: pr.quantity,
      assignments: matching,
      filledCount: matching.length,
      unfilledCount: Math.max(0, pr.quantity - matching.length),
    });
  }

  // 2) Remaining assignments (not linked to any defined ProjectRole)
  const remaining = assignments.filter((a) => !usedAssignmentIds.has(a.id));
  const byRoleName = new Map<string, Assignment[]>();
  for (const a of remaining) {
    const name = a.roleDefinition?.name || a.role || "(No Role)";
    if (!byRoleName.has(name)) byRoleName.set(name, []);
    byRoleName.get(name)!.push(a);
  }
  byRoleName.forEach((assigns, name) => {
    roleGroups.push({
      projectRoleId: null,
      roleName: name === "(No Role)" ? "" : name,
      requiredFte: 0,
      requiredQuantity: 0,
      assignments: assigns,
      filledCount: assigns.length,
      unfilledCount: 0,
    });
  });

  roleGroups.sort((a, b) => (a.roleName || "zzz").localeCompare(b.roleName || "zzz"));

  const handleAddRole = async () => {
    let roleDefId = addRoleForm.roleDefinitionId;
    if (roleDefId === "__new__") {
      if (!addRoleForm.newRoleName.trim()) return;
      const result = await createRoleDefinition(addRoleForm.newRoleName.trim());
      if (result.id) roleDefId = result.id;
      else return;
    }
    if (!roleDefId) return;
    const fte = Math.max(0.05, Math.min(2, parseFloat(addRoleForm.requiredFte) || 1));
    const qty = Math.max(1, Math.min(50, parseInt(addRoleForm.quantity) || 1));
    await createProjectRole(projectId, roleDefId, fte, qty);
    setAddRoleOpen(false);
    setAddRoleForm({ roleDefinitionId: "", newRoleName: "", requiredFte: "1", quantity: "1" });
  };

  const handleQuickAssign = (employeeId: string) => {
    if (!quickAssignCtx) return;
    startTransition(async () => {
      await quickAssign({
        employeeId,
        projectId,
        clientId: clientId || undefined,
        projectRoleId: quickAssignCtx.projectRoleId,
        roleDefinitionId: quickAssignCtx.roleDefinitionId,
        role: quickAssignCtx.roleName,
        allocationFte: quickAssignCtx.requiredFte,
        serviceOfferingId: serviceOfferingId || undefined,
      });
      setQuickAssignCtx(null);
    });
  };

  const handleRemove = (assignmentId: string, employeeName: string) => {
    if (!confirm(`Remove ${employeeName} from this project?`)) return;
    startTransition(async () => {
      await removeAssignment(assignmentId);
    });
  };

  const handleDeleteRole = (projectRoleId: string) => {
    if (!confirm("Delete this role requirement?")) return;
    startTransition(async () => {
      await deleteProjectRole(projectRoleId);
    });
  };

  const saveFte = (assignmentId: string, valueStr: string) => {
    const value = Math.max(0, Math.min(2, parseFloat(valueStr) || 0));
    startTransition(async () => {
      await updateAssignmentFte(assignmentId, value);
      setEditingFte(null);
    });
  };

  const saveRole = (assignmentId: string, roleDefId: string) => {
    const rd = roleDefinitions.find((r) => r.id === roleDefId);
    if (!rd) { setEditingRole(null); return; }
    startTransition(async () => {
      await updateAssignmentRole(assignmentId, rd.name, rd.id);
      setEditingRole(null);
    });
  };

  return (
    <div className="space-y-3">
      {roleGroups.length === 0 ? (
        <p className="text-sm text-muted-foreground italic">
          No staffing roles defined yet. Click &ldquo;Add Role&rdquo; to define what this project needs.
        </p>
      ) : (
        roleGroups.map((rg) => (
          <div key={`${rg.projectRoleId || "free"}-${rg.roleName}`} className="rounded-md border border-border bg-muted/20 p-2.5 space-y-1.5">
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="text-[10px]">{rg.roleName || "Unassigned"}</Badge>
              {rg.projectRoleId ? (
                <span className="text-[10px] text-muted-foreground">
                  {rg.filledCount}/{rg.requiredQuantity} filled · {rg.requiredFte.toFixed(2)} FTE each
                </span>
              ) : (
                <span className="text-[10px] text-muted-foreground">
                  {rg.filledCount} assigned
                </span>
              )}
              {rg.unfilledCount > 0 && (
                <Badge variant="outline" className="text-[9px] bg-amber-500/15 border-amber-500/50 text-amber-700 dark:text-amber-300 gap-0.5">
                  <AlertTriangle className="h-2.5 w-2.5" />
                  {rg.unfilledCount} open
                </Badge>
              )}
              {canEdit && rg.projectRoleId && (
                <button
                  onClick={() => handleDeleteRole(rg.projectRoleId!)}
                  disabled={isPending}
                  className="ml-auto p-0.5 rounded hover:bg-destructive/10 text-muted-foreground/40 hover:text-destructive transition-colors"
                  title="Remove role requirement"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>

            {/* Filled assignments */}
            {rg.assignments.map((a) => (
              <div key={a.id} className="flex items-center gap-2 rounded bg-background px-2 py-1.5 border border-border/40">
                <Link href={`/team/${a.employee.id}`} className="text-xs font-semibold text-foreground hover:text-primary hover:underline min-w-0 truncate">
                  {a.employee.name}
                </Link>
                {a.employee.jobTitle && (
                  <span className="text-[10px] text-muted-foreground truncate">— {a.employee.jobTitle}</span>
                )}
                {a.employee.location && (
                  <span className="text-[10px] text-muted-foreground flex items-center gap-0.5">
                    <MapPin className="h-2.5 w-2.5" />{a.employee.location}
                  </span>
                )}
                {a.serviceOffering && (
                  <Badge variant="secondary" className="text-[9px] px-1.5 py-0">{a.serviceOffering.name}</Badge>
                )}
                <div className="ml-auto flex items-center gap-2">
                  {editingRole === a.id && canEdit ? (
                    <select
                      autoFocus
                      defaultValue=""
                      onChange={(e) => saveRole(a.id, e.target.value)}
                      onBlur={() => setEditingRole(null)}
                      className="h-6 text-[10px] rounded border border-primary bg-background px-1 focus:outline-none"
                    >
                      <option value="">Select role...</option>
                      {roleDefinitions.map((rd) => (
                        <option key={rd.id} value={rd.id}>{rd.name}</option>
                      ))}
                    </select>
                  ) : canEdit ? (
                    <button
                      onClick={() => setEditingRole(a.id)}
                      className="text-[10px] text-muted-foreground hover:text-primary"
                      title="Change role"
                    >
                      {a.roleDefinition?.name || a.role || "—"}
                    </button>
                  ) : (
                    <span className="text-[10px] text-muted-foreground">{a.roleDefinition?.name || a.role || "—"}</span>
                  )}
                  {editingFte?.assignmentId === a.id && canEdit ? (
                    <input
                      type="number" step="0.05" min="0" max="2"
                      value={editingFte.value}
                      autoFocus
                      onChange={(e) => setEditingFte({ assignmentId: a.id, value: e.target.value })}
                      onBlur={() => saveFte(a.id, editingFte.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") saveFte(a.id, editingFte.value); }}
                      className="w-14 h-6 text-xs text-center border border-primary rounded bg-background focus:outline-none"
                    />
                  ) : canEdit ? (
                    <button
                      onClick={() => setEditingFte({ assignmentId: a.id, value: String(a.allocationFte) })}
                      className="font-bold text-xs text-blue-600 hover:text-primary"
                      title="Edit FTE"
                    >
                      {a.allocationFte.toFixed(2)}
                    </button>
                  ) : (
                    <span className="font-bold text-xs">{a.allocationFte.toFixed(2)}</span>
                  )}
                  {canEdit && (
                    <button
                      onClick={() => handleRemove(a.id, a.employee.name)}
                      disabled={isPending}
                      className="p-0.5 rounded hover:bg-destructive/10 text-muted-foreground/40 hover:text-destructive transition-colors"
                      title={`Remove ${a.employee.name}`}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  )}
                </div>
              </div>
            ))}

            {/* Unfilled slots */}
            {rg.unfilledCount > 0 && Array.from({ length: rg.unfilledCount }).map((_, i) => (
              <button
                key={`unfilled-${i}`}
                disabled={!canEdit}
                onClick={() => setQuickAssignCtx({
                  projectRoleId: rg.projectRoleId || undefined,
                  roleDefinitionId: projectRoles.find((pr) => pr.id === rg.projectRoleId)?.roleDefinition?.id,
                  roleName: rg.roleName,
                  requiredFte: rg.requiredFte || 1,
                })}
                className="w-full flex items-center gap-1.5 rounded border border-dashed border-amber-500/50 bg-amber-500/5 px-2 py-1.5 text-xs text-amber-700 dark:text-amber-300 hover:bg-amber-500/10 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <UserPlus className="h-3 w-3" />
                <span className="font-medium">Open — click to fill</span>
              </button>
            ))}
          </div>
        ))
      )}

      {canEdit && (
        <Button variant="outline" size="sm" className="w-full" onClick={() => setAddRoleOpen(true)}>
          <Plus className="h-4 w-4 mr-1" /> Add Role
        </Button>
      )}

      {/* Add Role Dialog */}
      {addRoleOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setAddRoleOpen(false)}>
          <div className="bg-background rounded-lg shadow-xl border p-5 w-full max-w-md space-y-4" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-semibold text-sm">Add Role</h3>
            <div className="space-y-3">
              <div className="space-y-1">
                <label className="text-xs font-medium">Role *</label>
                <select
                  value={addRoleForm.roleDefinitionId}
                  onChange={(e) => setAddRoleForm((f) => ({ ...f, roleDefinitionId: e.target.value, newRoleName: "" }))}
                  className="w-full h-9 rounded border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                >
                  <option value="">Select role...</option>
                  {roleDefinitions.map((rd) => (
                    <option key={rd.id} value={rd.id}>{rd.name}</option>
                  ))}
                  <option value="__new__">+ Add new role...</option>
                </select>
              </div>
              {addRoleForm.roleDefinitionId === "__new__" && (
                <div className="space-y-1">
                  <label className="text-xs font-medium">New Role Name *</label>
                  <input
                    value={addRoleForm.newRoleName}
                    onChange={(e) => setAddRoleForm((f) => ({ ...f, newRoleName: e.target.value }))}
                    placeholder="e.g. Lead Technician"
                    className="w-full h-9 rounded border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                </div>
              )}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs font-medium">FTE per Position</label>
                  <input
                    type="number" step="0.05" min="0.05" max="2"
                    value={addRoleForm.requiredFte}
                    onChange={(e) => setAddRoleForm((f) => ({ ...f, requiredFte: e.target.value }))}
                    className="w-full h-9 rounded border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium">Quantity Needed</label>
                  <input
                    type="number" min="1" max="50"
                    value={addRoleForm.quantity}
                    onChange={(e) => setAddRoleForm((f) => ({ ...f, quantity: e.target.value }))}
                    className="w-full h-9 rounded border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="outline" size="sm" onClick={() => setAddRoleOpen(false)}>Cancel</Button>
              <Button
                size="sm"
                onClick={handleAddRole}
                disabled={!addRoleForm.roleDefinitionId || (addRoleForm.roleDefinitionId === "__new__" && !addRoleForm.newRoleName.trim())}
              >
                Add Role
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Quick Assign Dialog */}
      {quickAssignCtx && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setQuickAssignCtx(null)}>
          <div className="bg-background rounded-lg shadow-xl border p-5 w-full max-w-sm space-y-4" onClick={(e) => e.stopPropagation()}>
            <div>
              <h3 className="font-semibold text-sm">Assign Employee</h3>
              <p className="text-xs text-muted-foreground mt-1">
                {quickAssignCtx.roleName && <><span className="font-medium">{quickAssignCtx.roleName}</span> — </>}
                {quickAssignCtx.requiredFte.toFixed(2)} FTE
              </p>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium">Select Employee</label>
              <select
                autoFocus
                onChange={(e) => { if (e.target.value) handleQuickAssign(e.target.value); }}
                className="w-full h-10 rounded border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              >
                <option value="">Choose employee...</option>
                {allUsers.map((u) => (
                  <option key={u.id} value={u.id}>{u.name}{u.jobTitle ? ` — ${u.jobTitle}` : ""}</option>
                ))}
              </select>
            </div>
            <div className="flex justify-end">
              <Button variant="outline" size="sm" onClick={() => setQuickAssignCtx(null)}>Cancel</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
