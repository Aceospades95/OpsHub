"use client";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useFormState } from "react-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { FormDialog } from "@/components/shared/form-dialog";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { useConfirm } from "@/components/shared/use-confirm";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import Link from "next/link";
import {
  User, Briefcase, BarChart3, FolderOpen, MapPin, Phone,
  Mail, Calendar, Users, FileText, ChevronRight, Shield,
  AlertTriangle, Pencil, Trash2, Plus, KeyRound, FileWarning,
} from "lucide-react";

import { formatDistanceToNow } from "date-fns";
import { updateUser, deleteUser, saveModulePermissions, saveEntityPermission, deleteEntityPermission, resetUserPassword } from "@/actions/admin";
import { unlinkGoogleAccount } from "@/actions/auth";
import { deleteAssignment } from "@/actions/assignments";
import { AddAssignmentDialog } from "../components/add-assignment-dialog";
import type { UserData } from "../components/team-types";
import { getPermissionedModules, ALL_PERMISSION_FLAGS, PERMISSION_FLAG_LABELS } from "@/lib/modules";
import { getRoleDefaults } from "@/lib/permissions";
import { DisciplinaryTab, type DisciplinaryReportRow } from "./disciplinary-tab";
import { roleOptionsFor } from "@/lib/roles";

interface Assignment {
  id: string;
  allocationFte: number;
  status: string;
  role: string | null;
  function: string | null;
  notes: string | null;
  startDate: string | null;
  endDate: string | null;
  project: { id: string; name: string; status: string } | null;
  client: { id: string; name: string } | null;
  serviceOffering: { id: string; name: string } | null;
}

interface Employee {
  id: string;
  name: string;
  email: string;
  role: string;
  jobTitle: string | null;
  department: string | null;
  location: string | null;
  phone: string | null;
  avatar: string | null;
  isActive: boolean;
  hasLoginAccess: boolean;
  authProvider: string;
  managerId: string | null;
  createdAt: string;
  manager: { id: string; name: string; jobTitle: string | null; avatar: string | null } | null;
  directReports: { id: string; name: string; email: string; role: string; jobTitle: string | null; avatar: string | null }[];
  projectMembers: {
    id: string;
    role: string;
    project: { id: string; name: string; status: string; client: { id: string; name: string } | null };
  }[];
  assignments: Assignment[];
  modulePermissions: { module: string; canView: boolean; canEdit: boolean; canCreate: boolean; canDelete: boolean; canComment: boolean; canUpload: boolean; canManage: boolean }[];
  entityPermissions: { id: string; entityType: string; entityId: string; canView: boolean; canEdit: boolean; canComment: boolean; canUpload: boolean; canManage: boolean }[];
  /** OAuth-provider linkage rows (currently always provider="google"). Empty = password-only. */
  accounts: { id: string; provider: string; createdAt: string }[];
}

interface ActivityLog {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  details: string | null;
  createdAt: string;
}

type TabKey = "overview" | "assignments" | "reporting" | "projects" | "permissions" | "disciplinary" | "activity";

function formatFte(v: number): string {
  return v % 1 === 0 ? v.toFixed(0) : v.toFixed(2);
}

export function EmployeeDetailClient({
  employee, activity, canManage, isAdmin, allUsers, allClients, allProjects, serviceOfferings, roleDefinitions, customPages, disciplinaryReports,
}: {
  employee: Employee;
  activity: ActivityLog[];
  canManage: boolean;
  isAdmin: boolean;
  allUsers: { id: string; name: string }[];
  allClients: { id: string; name: string }[];
  allProjects: { id: string; name: string; status: string; clientId: string; serviceOfferingId: string | null; serviceOffering: { id: string; name: string } | null }[];
  serviceOfferings: { id: string; name: string }[];
  roleDefinitions: { id: string; name: string }[];
  customPages: { id: string; title: string; slug: string }[];
  disciplinaryReports: DisciplinaryReportRow[];
}) {
  const [activeTab, setActiveTab] = useState<TabKey>("overview");
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [resetPwOpen, setResetPwOpen] = useState(false);
  const [resetPwValue, setResetPwValue] = useState("");
  const [resetPwError, setResetPwError] = useState<string | null>(null);
  const [resetPwSuccess, setResetPwSuccess] = useState(false);
  const [resetPwPending, setResetPwPending] = useState(false);
  const [addAssignmentOpen, setAddAssignmentOpen] = useState(false);
  const router = useRouter();
  const { confirm: confirmAction, ConfirmDialog: HookConfirmDialog } = useConfirm();

  const canResetPassword =
    isAdmin && employee.hasLoginAccess && employee.authProvider === "credentials";

  async function handleResetPassword() {
    setResetPwError(null);
    setResetPwPending(true);
    const fd = new FormData();
    fd.set("id", employee.id);
    fd.set("newPassword", resetPwValue);
    const result = await resetUserPassword(null, fd);
    setResetPwPending(false);
    if (result.success) {
      setResetPwSuccess(true);
      setResetPwValue("");
    } else {
      setResetPwError(result.error ?? "Failed to reset password");
    }
  }

  function closeResetPw() {
    setResetPwOpen(false);
    setResetPwValue("");
    setResetPwError(null);
    setResetPwSuccess(false);
  }

  const activeAssignments = employee.assignments.filter((a) => a.status === "ACTIVE" || a.status === "PLANNED");
  const totalFte = activeAssignments.reduce((sum, a) => sum + a.allocationFte, 0);
  const remaining = 1.0 - totalFte;
  const isOver = totalFte > 1.0;
  const isFull = totalFte >= 0.95 && totalFte <= 1.0;

  const tabs: { key: TabKey; label: string; icon: React.ElementType }[] = [
    { key: "overview", label: "Overview", icon: User },
    { key: "assignments", label: "Assignments & Capacity", icon: BarChart3 },
    { key: "reporting", label: "Reporting", icon: Users },
    { key: "projects", label: "Projects", icon: FolderOpen },
    ...(isAdmin ? [{ key: "permissions" as TabKey, label: "Permissions", icon: Shield }] : []),
    // HR-sensitive — only rendered for ADMIN/MANAGER viewers (the server
    // page only fetches reports for them too).
    ...(canManage ? [{ key: "disciplinary" as TabKey, label: "Disciplinary", icon: FileWarning }] : []),
    { key: "activity", label: "Activity", icon: FileText },
  ];

  async function runDelete() {
    const fd = new FormData();
    fd.set("id", employee.id);
    return deleteUser(null, fd);
  }

  // Map user data for the assignment dialog. The local `Assignment`
  // shape served by /team/[employeeId]/page.tsx omits the role-slot
  // fields the dialog only uses when editing, so fill them with nulls
  // — the dialog tolerates missing slots and prompts for one.
  const userDataForDialog: UserData[] = [{
    id: employee.id,
    name: employee.name,
    email: employee.email,
    role: employee.role,
    jobTitle: employee.jobTitle,
    department: employee.department,
    location: employee.location,
    avatar: employee.avatar,
    managerId: employee.managerId,
    manager: employee.manager,
    directReports: employee.directReports.map((r) => ({ id: r.id, name: r.name })),
    isActive: employee.isActive,
    projectMembers: employee.projectMembers.map((pm) => ({ role: pm.role, project: { ...pm.project, clientId: pm.project.client?.id || "" } })),
    assignments: employee.assignments.map((a) => ({
      ...a,
      projectRoleId: null,
      projectRole: null,
      roleDefinition: null,
    })),
  }];

  return (
    <div className="space-y-6">
      {/* Profile Header Card */}
      <Card>
        <CardContent className="p-6">
          <div className="flex items-start gap-6 flex-wrap md:flex-nowrap">
            <Avatar name={employee.name} src={employee.avatar} size="lg" />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-3 flex-wrap">
                <h2 className="text-xl font-bold">{employee.name}</h2>
                <Badge variant={employee.isActive ? "success" : "destructive"}>
                  {employee.isActive ? "Active" : "Inactive"}
                </Badge>
                <Badge variant={employee.role === "ADMIN" ? "default" : "secondary"}>{employee.role}</Badge>
                {!employee.hasLoginAccess && <Badge variant="outline">No Login</Badge>}
                {employee.accounts.some((a) => a.provider === "google") && (
                  <span title="Linked to a Google account for SSO">
                    <Badge variant="outline">Google linked</Badge>
                  </span>
                )}
              </div>
              {employee.jobTitle && <p className="text-sm text-primary/80 font-medium mt-1">{employee.jobTitle}</p>}
              <div className="flex items-center gap-4 mt-3 text-sm text-muted-foreground flex-wrap">
                <span className="flex items-center gap-1"><Mail className="h-3.5 w-3.5" />{employee.email}</span>
                {employee.phone && <span className="flex items-center gap-1"><Phone className="h-3.5 w-3.5" />{employee.phone}</span>}
                {employee.location && <span className="flex items-center gap-1"><MapPin className="h-3.5 w-3.5" />{employee.location}</span>}
                {employee.department && <span className="flex items-center gap-1"><Briefcase className="h-3.5 w-3.5" />{employee.department}</span>}
              </div>
              {/* Action buttons */}
              {canManage && (
                <div className="flex gap-2 mt-3 flex-wrap">
                  <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
                    <Pencil className="h-3.5 w-3.5 mr-1" /> Edit
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => setAddAssignmentOpen(true)}>
                    <Plus className="h-3.5 w-3.5 mr-1" /> Add Assignment
                  </Button>
                  {canResetPassword && (
                    <Button variant="outline" size="sm" onClick={() => setResetPwOpen(true)}>
                      <KeyRound className="h-3.5 w-3.5 mr-1" /> Reset Password
                    </Button>
                  )}
                  {isAdmin && employee.accounts.some((a) => a.provider === "google") && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={async () => {
                        const ok = await confirmAction({
                          title: `Unlink the Google account from ${employee.name}?`,
                          message:
                            "They will re-link automatically on their next Google sign-in (assuming login access stays enabled).",
                          confirmLabel: "Unlink",
                        });
                        if (!ok) return;
                        await unlinkGoogleAccount(employee.id);
                        router.refresh();
                      }}
                    >
                      Unlink Google
                    </Button>
                  )}
                  {isAdmin && (
                    <Button variant="destructive" size="sm" onClick={() => setDeleteOpen(true)}>
                      <Trash2 className="h-3.5 w-3.5 mr-1" /> Delete
                    </Button>
                  )}
                </div>
              )}
            </div>
            {/* FTE Summary */}
            <div className="text-right shrink-0">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">FTE Allocation</p>
              <p className={`text-3xl font-bold ${isOver ? "text-destructive" : isFull ? "text-success" : ""}`}>{formatFte(totalFte)}</p>
              <p className="text-xs text-muted-foreground">
                {remaining > 0 ? `${formatFte(remaining)} available` : remaining < 0 ? `${formatFte(Math.abs(remaining))} over` : "Fully allocated"}
              </p>
              <div className="h-1.5 w-24 bg-muted rounded-full overflow-hidden mt-1 ml-auto">
                <div
                  className={`h-full rounded-full ${isOver ? "bg-destructive" : isFull ? "bg-success" : totalFte > 0 ? "bg-warning" : "bg-muted-foreground/30"}`}
                  style={{ width: `${Math.min(totalFte * 100, 100)}%` }}
                />
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Tab Navigation */}
      <div className="flex border-b border-border overflow-x-auto">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                activeTab === tab.key
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              <Icon className="h-4 w-4" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Tab Content */}
      {activeTab === "overview" && <OverviewTab employee={employee} totalFte={totalFte} activeAssignments={activeAssignments} canManage={canManage} onAddAssignment={() => setAddAssignmentOpen(true)} />}
      {activeTab === "assignments" && <AssignmentsTab employee={employee} totalFte={totalFte} canManage={canManage} onAddAssignment={() => setAddAssignmentOpen(true)} />}
      {activeTab === "reporting" && <ReportingTab employee={employee} />}
      {activeTab === "projects" && <ProjectsTab employee={employee} />}
      {activeTab === "permissions" && isAdmin && <PermissionsTab employee={employee} allClients={allClients} allProjects={allProjects} customPages={customPages} />}
      {activeTab === "disciplinary" && canManage && (
        <DisciplinaryTab
          employeeId={employee.id}
          employeeName={employee.name}
          reports={disciplinaryReports}
          isAdmin={isAdmin}
        />
      )}
      {activeTab === "activity" && <ActivityTab activity={activity} />}

      {/* Edit Dialog */}
      {canManage && (
        <FormDialog open={editOpen} onClose={() => setEditOpen(false)} title="Edit Employee" action={updateUser}>
          {({ fieldErrors }) => (
            <>
              <input type="hidden" name="id" value={employee.id} />
              <Input name="name" label="Name" defaultValue={employee.name} required error={fieldErrors?.name?.[0]} />
              <Input name="email" label="Email" type="email" defaultValue={employee.email} required error={fieldErrors?.email?.[0]} />
              <Select name="role" label="Role" defaultValue={employee.role} options={roleOptionsFor(employee.role)} />
              <div className="grid grid-cols-2 gap-3">
                <Input name="department" label="Department" defaultValue={employee.department || ""} />
                <Input name="jobTitle" label="Job Title" defaultValue={employee.jobTitle || ""} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Input name="phone" label="Phone" defaultValue={employee.phone || ""} />
                <Input name="location" label="Location" defaultValue={employee.location || ""} />
              </div>
              <Select name="managerId" label="Manager" defaultValue={employee.managerId || ""} options={allUsers.map(u => ({ label: u.name, value: u.id }))} placeholder="None" />
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="isActive" value="true" defaultChecked={employee.isActive} className="rounded" />
                Active
              </label>
            </>
          )}
        </FormDialog>
      )}

      {/* Delete Dialog */}
      {isAdmin && (
        <ConfirmDialog
          open={deleteOpen}
          onClose={() => setDeleteOpen(false)}
          title="Delete Employee"
          message={<>Delete <strong>{employee.name}</strong>? This is irreversible.</>}
          onConfirm={runDelete}
          navigateTo="/team"
          confirmLabel="Delete"
        />
      )}

      {/* Reset Password Dialog (admin, credentials accounts only) */}
      {canResetPassword && (
        <Dialog open={resetPwOpen} onClose={closeResetPw} title="Reset Password">
          {resetPwSuccess ? (
            <>
              <p className="text-sm mb-4">
                Password updated for <strong>{employee.name}</strong>. Share the new
                password with them through a secure channel — it is not sent automatically.
              </p>
              <div className="flex justify-end">
                <Button onClick={closeResetPw}>Done</Button>
              </div>
            </>
          ) : (
            <>
              <p className="text-sm text-muted-foreground mb-4">
                Set a new password for <strong>{employee.name}</strong>. They will need to
                sign in again with the new password. Minimum 8 characters.
              </p>
              <Input
                type="password"
                label="New Password"
                value={resetPwValue}
                onChange={(e) => setResetPwValue(e.target.value)}
                minLength={8}
                autoComplete="new-password"
                error={resetPwError ?? undefined}
              />
              <div className="flex justify-end gap-2 mt-4">
                <Button variant="outline" onClick={closeResetPw} disabled={resetPwPending}>
                  Cancel
                </Button>
                <Button
                  onClick={handleResetPassword}
                  disabled={resetPwPending || resetPwValue.length < 8}
                >
                  {resetPwPending ? "Saving…" : "Reset Password"}
                </Button>
              </div>
            </>
          )}
        </Dialog>
      )}

      {/* Add Assignment Dialog */}
      {canManage && (
        <AddAssignmentDialog
          open={addAssignmentOpen}
          onClose={() => setAddAssignmentOpen(false)}
          users={userDataForDialog}
          projects={allProjects}
          clients={allClients}
          serviceOfferings={serviceOfferings}
          roleDefinitions={roleDefinitions}
          defaultEmployeeId={employee.id}
        />
      )}
      <HookConfirmDialog />
    </div>
  );
}

// ─── Overview Tab ──────────────────────────────

function OverviewTab({ employee, totalFte, activeAssignments, canManage, onAddAssignment }: {
  employee: Employee; totalFte: number; activeAssignments: Assignment[]; canManage: boolean; onAddAssignment: () => void;
}) {
  const remaining = 1.0 - totalFte;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <div className="lg:col-span-2 space-y-6">
        <Card>
          <CardHeader><CardTitle>Employee Information</CardTitle></CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <InfoField label="Full Name" value={employee.name} />
              <InfoField label="Email" value={employee.email} />
              <InfoField label="Job Title" value={employee.jobTitle} />
              <InfoField label="Department" value={employee.department} />
              <InfoField label="Location" value={employee.location} />
              <InfoField label="Phone" value={employee.phone} />
              <InfoField label="System Role" value={employee.role} />
              <InfoField label="Status" value={employee.isActive ? "Active" : "Inactive"} />
              {employee.manager && (
                <div>
                  <p className="text-muted-foreground text-xs mb-0.5">Reports To</p>
                  <Link href={`/team/${employee.manager.id}`} className="text-primary hover:underline font-medium">{employee.manager.name}</Link>
                </div>
              )}
              <InfoField label="Member Since" value={new Date(employee.createdAt).toLocaleDateString()} />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Capacity Overview</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Total Allocation</span>
              <span className={`text-lg font-bold ${totalFte > 1 ? "text-destructive" : totalFte >= 0.95 ? "text-success" : ""}`}>
                {formatFte(totalFte)} / 1.0 FTE
              </span>
            </div>
            <div className="h-3 bg-muted rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${totalFte > 1 ? "bg-destructive" : totalFte >= 0.95 ? "bg-success" : totalFte > 0 ? "bg-warning" : "bg-muted-foreground/30"}`}
                style={{ width: `${Math.min(totalFte * 100, 100)}%` }}
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-center">
              <div className="p-3 rounded-lg bg-muted"><p className="text-xs text-muted-foreground">Allocated</p><p className="text-lg font-bold">{formatFte(totalFte)}</p></div>
              <div className="p-3 rounded-lg bg-muted"><p className="text-xs text-muted-foreground">Available</p><p className={`text-lg font-bold ${remaining < 0 ? "text-destructive" : remaining > 0 ? "text-success" : ""}`}>{formatFte(Math.max(remaining, 0))}</p></div>
              <div className="p-3 rounded-lg bg-muted"><p className="text-xs text-muted-foreground">Assignments</p><p className="text-lg font-bold">{activeAssignments.length}</p></div>
            </div>
            {totalFte > 1 && (
              <div className="flex items-center gap-2 p-3 rounded-lg bg-destructive/10 border border-destructive/30 text-destructive text-sm">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                <span>Overallocated by {formatFte(totalFte - 1)} FTE.</span>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="space-y-6">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Current Assignments ({activeAssignments.length})</CardTitle>
              {canManage && (
                <button onClick={onAddAssignment} className="text-xs text-primary hover:underline flex items-center gap-1">
                  <Plus className="h-3 w-3" /> Add
                </button>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {activeAssignments.length === 0 ? (
              <p className="text-sm text-muted-foreground">No active assignments.</p>
            ) : (
              <div className="space-y-2">
                {activeAssignments.map((a) => (
                  <div key={a.id} className="flex items-center justify-between p-2 rounded border border-border bg-muted text-sm">
                    <div className="min-w-0">
                      <p className="font-medium truncate">
                        {a.project ? <Link href={`/projects/${a.project.id}`} className="text-primary hover:underline">{a.project.name}</Link>
                        : a.client?.name || a.serviceOffering?.name || a.function || "General"}
                      </p>
                      {a.role && <p className="text-[10px] text-muted-foreground">{a.role}</p>}
                    </div>
                    <span className="font-bold text-xs shrink-0 ml-2">{formatFte(a.allocationFte)}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {employee.directReports.length > 0 && (
          <Card>
            <CardHeader><CardTitle>Direct Reports ({employee.directReports.length})</CardTitle></CardHeader>
            <CardContent>
              <div className="space-y-2">
                {employee.directReports.map((report) => (
                  <Link key={report.id} href={`/team/${report.id}`}
                    className="flex items-center gap-2 rounded border border-border bg-muted p-2 hover:bg-muted transition-colors">
                    <Avatar name={report.name} src={report.avatar} size="xs" />
                    <div className="min-w-0">
                      <span className="text-sm font-medium truncate block">{report.name}</span>
                      {report.jobTitle && <span className="text-[10px] text-muted-foreground">{report.jobTitle}</span>}
                    </div>
                    <Badge variant="outline" className="ml-auto text-[9px]">{report.role}</Badge>
                  </Link>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

// ─── Assignments Tab ──────────────────────────

function AssignmentsTab({ employee, totalFte, canManage, onAddAssignment }: {
  employee: Employee; totalFte: number; canManage: boolean; onAddAssignment: () => void;
}) {
  const router = useRouter();
  const activeAssignments = employee.assignments.filter((a) => a.status === "ACTIVE" || a.status === "PLANNED");
  const completedAssignments = employee.assignments.filter((a) => a.status === "COMPLETED" || a.status === "ON_HOLD");

  async function handleDeleteAssignment(id: string) {
    const fd = new FormData();
    fd.set("id", id);
    await deleteAssignment(null, fd);
    router.refresh();
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>FTE Allocation Breakdown</CardTitle>
            {canManage && (
              <Button variant="outline" size="sm" onClick={onAddAssignment}>
                <Plus className="h-3.5 w-3.5 mr-1" /> Add Assignment
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {activeAssignments.length === 0 ? (
            <p className="text-sm text-muted-foreground">No active allocations.</p>
          ) : (
            <div className="space-y-3">
              {activeAssignments.map((a) => {
                const pct = (a.allocationFte / Math.max(totalFte, 1)) * 100;
                return (
                  <div key={a.id} className="space-y-1">
                    <div className="flex items-center justify-between text-sm">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">
                          {a.project?.name || a.client?.name || a.serviceOffering?.name || a.function || "General"}
                        </span>
                        {a.role && <Badge variant="outline" className="text-[9px]">{a.role}</Badge>}
                        {a.serviceOffering && <Badge variant="secondary" className="text-[9px]">{a.serviceOffering.name}</Badge>}
                        <Badge variant={a.status === "ACTIVE" ? "success" : "warning"} className="text-[9px]">{a.status}</Badge>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="font-bold">{formatFte(a.allocationFte)} FTE</span>
                        {canManage && (
                          <button onClick={() => handleDeleteAssignment(a.id)} className="text-muted-foreground hover:text-destructive p-0.5" title="Remove">
                            <Trash2 className="h-3 w-3" />
                          </button>
                        )}
                      </div>
                    </div>
                    <div className="h-2 bg-muted rounded-full overflow-hidden">
                      <div className="h-full bg-primary/70 rounded-full" style={{ width: `${pct}%` }} />
                    </div>
                    <div className="flex gap-3 text-[10px] text-muted-foreground">
                      {a.startDate && <span>Start: {new Date(a.startDate).toLocaleDateString()}</span>}
                      {a.endDate && <span>End: {new Date(a.endDate).toLocaleDateString()}</span>}
                      {a.notes && <span className="truncate">{a.notes}</span>}
                    </div>
                  </div>
                );
              })}
              <div className="flex items-center justify-between pt-3 border-t border-border font-semibold text-sm">
                <span>Total</span>
                <span className={totalFte > 1 ? "text-destructive" : ""}>{formatFte(totalFte)} / 1.0 FTE</span>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {completedAssignments.length > 0 && (
        <Card>
          <CardHeader><CardTitle>Past / On Hold ({completedAssignments.length})</CardTitle></CardHeader>
          <CardContent>
            <div className="space-y-2">
              {completedAssignments.map((a) => (
                <div key={a.id} className="flex items-center justify-between p-2 rounded border border-border bg-muted text-sm opacity-60">
                  <span className="font-medium truncate">{a.project?.name || a.client?.name || a.serviceOffering?.name || a.function || "General"}</span>
                  <div className="flex items-center gap-2">
                    <span className="text-xs">{formatFte(a.allocationFte)} FTE</span>
                    <Badge variant="outline" className="text-[9px]">{a.status}</Badge>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ─── Reporting Tab ──────────────────────────

function ReportingTab({ employee }: { employee: Employee }) {
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader><CardTitle>Reports To</CardTitle></CardHeader>
        <CardContent>
          {employee.manager ? (
            <Link href={`/team/${employee.manager.id}`} className="flex items-center gap-3 p-3 rounded-lg border border-border hover:bg-muted transition-colors">
              <Avatar name={employee.manager.name} src={employee.manager.avatar} size="md" />
              <div><p className="font-semibold">{employee.manager.name}</p>{employee.manager.jobTitle && <p className="text-sm text-muted-foreground">{employee.manager.jobTitle}</p>}</div>
              <ChevronRight className="h-4 w-4 ml-auto text-muted-foreground" />
            </Link>
          ) : <p className="text-sm text-muted-foreground">No manager assigned.</p>}
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Direct Reports ({employee.directReports.length})</CardTitle></CardHeader>
        <CardContent>
          {employee.directReports.length === 0 ? <p className="text-sm text-muted-foreground">No direct reports.</p> : (
            <div className="space-y-2">
              {employee.directReports.map((report) => (
                <Link key={report.id} href={`/team/${report.id}`} className="flex items-center gap-3 p-2.5 rounded border border-border bg-muted hover:bg-muted transition-colors">
                  <Avatar name={report.name} src={report.avatar} size="sm" />
                  <div className="min-w-0 flex-1"><p className="font-medium truncate">{report.name}</p>{report.jobTitle && <p className="text-xs text-muted-foreground">{report.jobTitle}</p>}</div>
                  <Badge variant="outline" className="text-[9px]">{report.role}</Badge>
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Projects Tab ──────────────────────────

function ProjectsTab({ employee }: { employee: Employee }) {
  return (
    <Card>
      <CardHeader><CardTitle>Project Memberships ({employee.projectMembers.length})</CardTitle></CardHeader>
      <CardContent>
        {employee.projectMembers.length === 0 ? <p className="text-sm text-muted-foreground">Not assigned to any projects.</p> : (
          <div className="space-y-2">
            {employee.projectMembers.map((pm) => {
              const assignment = employee.assignments.find((a) => a.project?.id === pm.project.id && (a.status === "ACTIVE" || a.status === "PLANNED"));
              return (
                <Link key={pm.id} href={`/projects/${pm.project.id}`} className="flex items-center gap-3 p-3 rounded border border-border bg-muted hover:bg-muted transition-colors">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{pm.project.name}</p>
                    {pm.project.client && <p className="text-xs text-muted-foreground">Client: {pm.project.client.name}</p>}
                  </div>
                  <Badge variant="outline" className="text-[9px]">{pm.role}</Badge>
                  <Badge variant={pm.project.status === "ACTIVE" ? "success" : "secondary"} className="text-[9px]">{pm.project.status}</Badge>
                  {assignment && <span className="text-xs font-bold">{formatFte(assignment.allocationFte)} FTE</span>}
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                </Link>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Permissions Tab (Admin only) ──────────────

function PermissionsTab({ employee, allClients, allProjects, customPages }: {
  employee: Employee;
  allClients: { id: string; name: string }[];
  allProjects: { id: string; name: string }[];
  customPages: { id: string; title: string; slug: string }[];
}) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [addEntityOpen, setAddEntityOpen] = useState(false);
  const [editingPerm, setEditingPerm] = useState<Employee["entityPermissions"][number] | null>(null);
  const [entityType, setEntityType] = useState("client");

  // Driven from the module registry — adding a new permissioned module in
  // src/lib/modules.ts automatically adds a row here.
  const modules = getPermissionedModules();
  const permMap = new Map(employee.modulePermissions.map((p) => [p.module, p]));
  // ADMIN always has full access; for other roles, fall back to role
  // defaults when no explicit permission row exists. Defaults are
  // per-module since the July 2026 access rework (field tier is
  // deny-by-default outside its allow-list).
  const roleDefaultsFor = (module: string) =>
    getRoleDefaults(employee.role as import("@prisma/client").Role, module);
  const entities = entityType === "client" ? allClients : allProjects;
  const nameMap = new Map([...allClients.map((c) => [c.id, c.name] as const), ...allProjects.map((p) => [p.id, p.name] as const)]);

  async function handleSaveModule(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    const formData = new FormData(e.currentTarget);
    formData.set("userId", employee.id);
    await saveModulePermissions(null, formData);
    setSaving(false);
    router.refresh();
  }

  async function handleAddEntity(formData: FormData) {
    formData.set("userId", employee.id);
    await saveEntityPermission(null, formData);
    setAddEntityOpen(false);
    router.refresh();
  }

  async function handleDeleteEntity(id: string) {
    const fd = new FormData();
    fd.set("id", id);
    await deleteEntityPermission(null, fd);
    router.refresh();
  }

  async function handleEditEntity(formData: FormData) {
    formData.set("userId", employee.id);
    await saveEntityPermission(null, formData);
    setEditingPerm(null);
    router.refresh();
  }

  return (
    <div className="space-y-6">
      {/* Module Permissions */}
      <Card>
        <CardHeader><CardTitle>Module Permissions</CardTitle></CardHeader>
        <CardContent>
          <form onSubmit={handleSaveModule}>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left p-2 font-medium">Module</th>
                    {ALL_PERMISSION_FLAGS.map((flag) => (
                      <th key={flag} className="p-2 font-medium text-center text-xs">{PERMISSION_FLAG_LABELS[flag]}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {modules.map((mod) => {
                    const perm = permMap.get(mod.key);
                    return (
                      <tr key={mod.key} className="border-b border-border">
                        <td className="p-2 font-medium">
                          <div>{mod.label}</div>
                          <div className="text-[11px] text-muted-foreground font-normal">{mod.description}</div>
                        </td>
                        {ALL_PERMISSION_FLAGS.map((flag) => {
                          const checked = perm
                            ? (perm as unknown as Record<string, boolean>)[flag]
                            : (roleDefaultsFor(mod.key) as unknown as Record<string, boolean>)[flag];
                          return (
                            <td key={flag} className="p-2 text-center">
                              <input type="checkbox" name={`${mod.key}_${flag}`} value="true"
                                defaultChecked={checked} className="rounded" />
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                  {/* Custom pages — appear dynamically as they're published */}
                  {customPages.length > 0 && (
                    <tr><td colSpan={ALL_PERMISSION_FLAGS.length + 1} className="p-2 pt-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Custom Pages</td></tr>
                  )}
                  {customPages.map((page) => {
                    const pageKey = `custom-page-${page.id}`;
                    const perm = permMap.get(pageKey);
                    return (
                      <tr key={pageKey} className="border-b border-border">
                        <td className="p-2 font-medium">
                          <div>{page.title}</div>
                          <div className="text-[11px] text-muted-foreground font-normal">/sandbox/{page.slug}</div>
                        </td>
                        {ALL_PERMISSION_FLAGS.map((flag) => {
                          const checked = perm
                            ? (perm as unknown as Record<string, boolean>)[flag]
                            : (roleDefaultsFor(pageKey) as unknown as Record<string, boolean>)[flag];
                          return (
                            <td key={flag} className="p-2 text-center">
                              <input type="checkbox" name={`${pageKey}_${flag}`} value="true"
                                defaultChecked={checked} className="rounded" />
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="mt-4 flex justify-end">
              <Button type="submit" size="sm" disabled={saving}>{saving ? "Saving..." : "Save Permissions"}</Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {/* Entity Permissions */}
      <Card>
        <CardHeader><CardTitle>Entity Permissions</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {employee.entityPermissions.length === 0 && <p className="text-sm text-muted-foreground">No entity-level overrides</p>}
          {employee.entityPermissions.map((perm) => (
            <div key={perm.id} className="flex items-center justify-between rounded border border-border bg-muted p-3">
              <div>
                <p className="text-sm font-medium">{perm.entityType}: {nameMap.get(perm.entityId) || perm.entityId}</p>
                <div className="flex gap-2 mt-1 text-xs text-muted-foreground">
                  {perm.canView && <span>View</span>}{perm.canEdit && <span>Edit</span>}{perm.canComment && <span>Comment</span>}{perm.canUpload && <span>Upload</span>}{perm.canManage && <span>Manage</span>}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => setEditingPerm(perm)} className="text-muted-foreground hover:text-foreground" aria-label="Edit">
                  <Pencil className="h-4 w-4" />
                </button>
                <button onClick={() => handleDeleteEntity(perm.id)} className="text-muted-foreground hover:text-destructive" aria-label="Delete">
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
          ))}
          <Button variant="outline" size="sm" className="w-full" onClick={() => setAddEntityOpen(true)}>
            <Plus className="h-4 w-4 mr-1" /> Add Entity Override
          </Button>

          <Dialog open={addEntityOpen} onClose={() => setAddEntityOpen(false)} title="Add Entity Permission">
            <form action={handleAddEntity} className="space-y-4">
              <Select name="entityType" label="Entity Type" value={entityType} onChange={(e) => setEntityType(e.target.value)}
                options={[{ label: "Client", value: "client" }, { label: "Project", value: "project" }]} />
              <Select name="entityId" label={entityType === "client" ? "Client" : "Project"}
                options={entities.map((e) => ({ label: e.name, value: e.id }))} placeholder="Select entity" required />
              <div className="space-y-2">
                <p className="text-sm font-medium">Permissions</p>
                {["canView", "canEdit", "canComment", "canUpload", "canManage"].map((flag) => (
                  <label key={flag} className="flex items-center gap-2 text-sm">
                    <input type="checkbox" name={flag} value="true" className="rounded" />{flag.replace("can", "")}
                  </label>
                ))}
              </div>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => setAddEntityOpen(false)}>Cancel</Button>
                <Button type="submit">Save</Button>
              </div>
            </form>
          </Dialog>

          {editingPerm && (
            <Dialog
              open={true}
              onClose={() => setEditingPerm(null)}
              title={`Edit ${editingPerm.entityType}: ${nameMap.get(editingPerm.entityId) || editingPerm.entityId}`}
            >
              <form action={handleEditEntity} className="space-y-4">
                <input type="hidden" name="entityType" value={editingPerm.entityType} />
                <input type="hidden" name="entityId" value={editingPerm.entityId} />
                <div className="space-y-2">
                  <p className="text-sm font-medium">Permissions</p>
                  {(["canView", "canEdit", "canComment", "canUpload", "canManage"] as const).map((flag) => (
                    <label key={flag} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        name={flag}
                        value="true"
                        defaultChecked={editingPerm[flag]}
                        className="rounded"
                      />
                      {flag.replace("can", "")}
                    </label>
                  ))}
                </div>
                <div className="flex justify-end gap-2">
                  <Button type="button" variant="outline" onClick={() => setEditingPerm(null)}>Cancel</Button>
                  <Button type="submit">Save</Button>
                </div>
              </form>
            </Dialog>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Activity Tab ──────────────────────────

function ActivityTab({ activity }: { activity: ActivityLog[] }) {
  return (
    <Card>
      <CardHeader><CardTitle>Recent Activity</CardTitle></CardHeader>
      <CardContent>
        {activity.length === 0 ? <p className="text-sm text-muted-foreground">No recent activity.</p> : (
          <div className="space-y-3">
            {activity.map((log) => (
              <div key={log.id} className="flex items-start gap-3 text-sm">
                <div className="mt-0.5 h-2 w-2 rounded-full bg-primary shrink-0" />
                <div>
                  <p><Badge variant="outline" className="mr-1 text-[9px]">{log.action}</Badge><span className="font-medium">{log.entityType}</span>{log.details && <span className="text-muted-foreground"> — {log.details}</span>}</p>
                  <p className="text-xs text-muted-foreground">{formatDistanceToNow(new Date(log.createdAt), { addSuffix: true })}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function InfoField({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <p className="text-muted-foreground text-xs mb-0.5">{label}</p>
      <p className="font-medium">{value || "—"}</p>
    </div>
  );
}
