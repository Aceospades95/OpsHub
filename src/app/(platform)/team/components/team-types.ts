// Shared types for team page components

export interface AssignmentData {
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
  projectRoleId: string | null;
  projectRole: { id: string; roleDefinition: { id: string; name: string }; requiredFte: number } | null;
  roleDefinition: { id: string; name: string } | null;
}

export interface UserData {
  id: string;
  name: string;
  email: string;
  role: string;
  jobTitle: string | null;
  department: string | null;
  location: string | null;
  avatar: string | null;
  managerId: string | null;
  manager: { id: string; name: string } | null;
  directReports: { id: string; name: string }[];
  isActive: boolean;
  projectMembers: {
    role: string;
    project: { id: string; name: string; status: string; clientId: string };
  }[];
  assignments: AssignmentData[];
}

export interface ProjectData {
  id: string;
  name: string;
  status: string;
  clientId: string;
  serviceOfferingId: string | null;
  serviceOffering: { id: string; name: string } | null;
}

export interface ClientData {
  id: string;
  name: string;
}

export interface ServiceOfferingData {
  id: string;
  name: string;
}

export interface RoleDefinitionData {
  id: string;
  name: string;
}

export interface ProjectRoleData {
  id: string;
  projectId: string;
  roleDefinition: { id: string; name: string };
  requiredFte: number;
  quantity: number;
  assignments: { id: string; employeeId: string }[];
}

export type MatrixDimension = "project" | "client" | "serviceOffering" | "function" | "manager" | "role" | "location" | "department";

export const DIMENSION_LABELS: Record<MatrixDimension, string> = {
  project: "Project",
  client: "Client",
  serviceOffering: "Service Offering",
  function: "Function",
  manager: "Manager",
  role: "Role",
  location: "Location",
  department: "Department",
};

export type AllocationStatus = "overallocated" | "fully-allocated" | "underallocated" | "unassigned";

export function getAllocationStatus(totalFte: number): AllocationStatus {
  if (totalFte === 0) return "unassigned";
  if (totalFte > 1.0) return "overallocated";
  if (totalFte >= 0.95) return "fully-allocated";
  return "underallocated";
}

export function getAllocationBadge(status: AllocationStatus): { label: string; className: string } {
  switch (status) {
    case "overallocated":
      return { label: "Over", className: "bg-destructive/10 text-destructive border-destructive/30" };
    case "fully-allocated":
      return { label: "Full", className: "bg-success/10 text-success border-success/30" };
    case "underallocated":
      return { label: "Available", className: "bg-warning/15 text-warning border-warning/30" };
    case "unassigned":
      return { label: "Unassigned", className: "bg-muted text-muted-foreground border-border" };
  }
}

export function computeEmployeeFte(user: UserData): number {
  // FTE is the sum of explicit Assignment.allocationFte values only.
  //
  // Pre-fix this function ALSO added 1.0 for every ProjectMember the
  // user had without a matching Assignment — the rationale being
  // "they're on the project so they must be working on it." That's
  // wrong: ProjectMember is an *access* grant (see item 14), not a
  // staffing record. The QA stress test caught a senior user at 7 FTE
  // across 5 projects because four of those projects only had
  // ProjectMember entries (the user had access to inspect them) but
  // no Assignment (no actual staffing). The 1.0/each fallback
  // double-counted access-only relationships as full-time work.
  return user.assignments.reduce((sum, a) => sum + a.allocationFte, 0);
}

export function formatFte(value: number): string {
  return value % 1 === 0 ? value.toFixed(0) : value.toFixed(2);
}
