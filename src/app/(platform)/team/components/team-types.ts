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
}

export interface ClientData {
  id: string;
  name: string;
}

export interface ServiceOfferingData {
  id: string;
  name: string;
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
      return { label: "Over", className: "bg-red-100 text-red-800 border-red-200" };
    case "fully-allocated":
      return { label: "Full", className: "bg-green-100 text-green-800 border-green-200" };
    case "underallocated":
      return { label: "Available", className: "bg-yellow-100 text-yellow-800 border-yellow-200" };
    case "unassigned":
      return { label: "Unassigned", className: "bg-gray-100 text-gray-600 border-gray-200" };
  }
}

export function computeEmployeeFte(user: UserData): number {
  return user.assignments.reduce((sum, a) => sum + a.allocationFte, 0);
}

export function formatFte(value: number): string {
  return value % 1 === 0 ? value.toFixed(0) : value.toFixed(2);
}
