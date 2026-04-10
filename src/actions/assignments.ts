"use server";

import { db } from "@/lib/db";
import { requireAuth } from "@/lib/permissions";
import { logActivity } from "@/lib/activity";
import { revalidatePath } from "next/cache";
import { z } from "zod";

function requireAdminOrManager(role: string) {
  if (role !== "ADMIN" && role !== "MANAGER") throw new Error("Admin or Manager access required");
}

// Revalidate all paths where an assignment could appear
function revalidateAssignmentPaths(employeeId?: string | null, projectId?: string | null) {
  revalidatePath("/team", "layout");
  revalidatePath("/projects", "layout");
  if (employeeId) revalidatePath(`/team/${employeeId}`);
  if (projectId) revalidatePath(`/projects/${projectId}`);
}

const assignmentSchema = z.object({
  employeeId: z.string().min(1, "Employee is required"),
  projectId: z.string().optional(),
  clientId: z.string().optional(),
  serviceOfferingId: z.string().optional(),
  projectRoleId: z.string().optional(),
  roleDefinitionId: z.string().optional(),
  function: z.string().optional(),
  role: z.string().optional(),
  allocationFte: z.number().min(0).max(2),
  status: z.enum(["ACTIVE", "PLANNED", "COMPLETED", "ON_HOLD"]).optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  notes: z.string().optional(),
});

export async function createAssignment(_prev: unknown, formData: FormData) {
  const user = await requireAuth();
  requireAdminOrManager(user.role);

  const parsed = assignmentSchema.safeParse({
    employeeId: formData.get("employeeId"),
    projectId: formData.get("projectId") || undefined,
    clientId: formData.get("clientId") || undefined,
    serviceOfferingId: formData.get("serviceOfferingId") || undefined,
    projectRoleId: formData.get("projectRoleId") || undefined,
    roleDefinitionId: formData.get("roleDefinitionId") || undefined,
    function: formData.get("function") || undefined,
    role: formData.get("role") || undefined,
    allocationFte: parseFloat(formData.get("allocationFte") as string) || 0,
    status: (formData.get("status") as string) || "ACTIVE",
    startDate: formData.get("startDate") || undefined,
    endDate: formData.get("endDate") || undefined,
    notes: formData.get("notes") || undefined,
  });

  if (!parsed.success) return { error: "Invalid input", fieldErrors: parsed.error.flatten().fieldErrors };

  const assignment = await db.assignment.create({
    data: {
      ...parsed.data,
      startDate: parsed.data.startDate ? new Date(parsed.data.startDate) : undefined,
      endDate: parsed.data.endDate ? new Date(parsed.data.endDate) : undefined,
    },
  });

  await logActivity("created", "assignment", assignment.id, user.id, `Assignment for employee ${parsed.data.employeeId}`);
  revalidateAssignmentPaths(parsed.data.employeeId, parsed.data.projectId);
  return { success: true };
}

export async function updateAssignment(_prev: unknown, formData: FormData) {
  const user = await requireAuth();
  requireAdminOrManager(user.role);

  const id = formData.get("id") as string;

  const parsed = assignmentSchema.safeParse({
    employeeId: formData.get("employeeId"),
    projectId: formData.get("projectId") || undefined,
    clientId: formData.get("clientId") || undefined,
    serviceOfferingId: formData.get("serviceOfferingId") || undefined,
    projectRoleId: formData.get("projectRoleId") || undefined,
    roleDefinitionId: formData.get("roleDefinitionId") || undefined,
    function: formData.get("function") || undefined,
    role: formData.get("role") || undefined,
    allocationFte: parseFloat(formData.get("allocationFte") as string) || 0,
    status: (formData.get("status") as string) || "ACTIVE",
    startDate: formData.get("startDate") || undefined,
    endDate: formData.get("endDate") || undefined,
    notes: formData.get("notes") || undefined,
  });

  if (!parsed.success) return { error: "Invalid input", fieldErrors: parsed.error.flatten().fieldErrors };

  await db.assignment.update({
    where: { id },
    data: {
      ...parsed.data,
      startDate: parsed.data.startDate ? new Date(parsed.data.startDate) : null,
      endDate: parsed.data.endDate ? new Date(parsed.data.endDate) : null,
    },
  });

  await logActivity("updated", "assignment", id, user.id);
  revalidateAssignmentPaths(parsed.data.employeeId, parsed.data.projectId);
  return { success: true };
}

export async function deleteAssignment(_prev: unknown, formData: FormData) {
  const user = await requireAuth();
  requireAdminOrManager(user.role);

  const id = formData.get("id") as string;
  if (!id) return { error: "Assignment ID is required" };

  const assignment = await db.assignment.findUnique({
    where: { id },
    select: { employeeId: true, projectId: true },
  });

  await db.assignment.delete({ where: { id } });
  await logActivity("deleted", "assignment", id, user.id);
  revalidateAssignmentPaths(assignment?.employeeId, assignment?.projectId);
  return { success: true, error: null };
}

// Direct delete (for inline remove from staffing matrix)
export async function removeAssignment(assignmentId: string) {
  const user = await requireAuth();
  requireAdminOrManager(user.role);

  if (!assignmentId) return { error: "Assignment ID is required" };

  // Look up the assignment first so we can revalidate specific detail pages
  const assignment = await db.assignment.findUnique({
    where: { id: assignmentId },
    select: { employeeId: true, projectId: true },
  });
  if (!assignment) return { error: "Assignment not found" };

  await db.assignment.delete({ where: { id: assignmentId } });
  await logActivity("deleted", "assignment", assignmentId, user.id);
  revalidateAssignmentPaths(assignment.employeeId, assignment.projectId);
  return { success: true };
}

// Direct create (for quick-assign from staffing matrix)
export async function quickAssign(data: {
  employeeId: string;
  projectId: string;
  clientId?: string;
  projectRoleId?: string;
  roleDefinitionId?: string;
  role?: string;
  allocationFte: number;
  serviceOfferingId?: string;
}) {
  const user = await requireAuth();
  requireAdminOrManager(user.role);

  if (!data.employeeId || !data.projectId) return { error: "Employee and project are required" };

  const assignment = await db.assignment.create({
    data: {
      employeeId: data.employeeId,
      projectId: data.projectId,
      clientId: data.clientId || undefined,
      projectRoleId: data.projectRoleId || undefined,
      roleDefinitionId: data.roleDefinitionId || undefined,
      role: data.role || undefined,
      allocationFte: data.allocationFte,
      serviceOfferingId: data.serviceOfferingId || undefined,
      status: "ACTIVE",
    },
  });

  await logActivity("created", "assignment", assignment.id, user.id, `Quick-assigned to project`);
  revalidateAssignmentPaths(data.employeeId, data.projectId);
  return { success: true };
}

// Inline field updates (for staffing matrix direct editing)
export async function updateAssignmentNotes(assignmentId: string, notes: string) {
  const user = await requireAuth();
  requireAdminOrManager(user.role);

  const updated = await db.assignment.update({
    where: { id: assignmentId },
    data: { notes: notes || null },
    select: { employeeId: true, projectId: true },
  });

  await logActivity("updated", "assignment", assignmentId, user.id, "Updated notes");
  revalidateAssignmentPaths(updated.employeeId, updated.projectId);
  return { success: true };
}

export async function updateAssignmentRole(assignmentId: string, role: string, roleDefinitionId: string | null) {
  const user = await requireAuth();
  requireAdminOrManager(user.role);

  const updated = await db.assignment.update({
    where: { id: assignmentId },
    data: { role: role || null, roleDefinitionId },
    select: { employeeId: true, projectId: true },
  });

  await logActivity("updated", "assignment", assignmentId, user.id, `Updated role to ${role}`);
  revalidateAssignmentPaths(updated.employeeId, updated.projectId);
  return { success: true };
}

export async function updateAssignmentFte(assignmentId: string, allocationFte: number) {
  const user = await requireAuth();
  requireAdminOrManager(user.role);

  if (allocationFte < 0 || allocationFte > 2) return { error: "FTE must be between 0 and 2" };

  const updated = await db.assignment.update({
    where: { id: assignmentId },
    data: { allocationFte },
    select: { employeeId: true, projectId: true },
  });

  await logActivity("updated", "assignment", assignmentId, user.id, `Updated FTE to ${allocationFte}`);
  revalidateAssignmentPaths(updated.employeeId, updated.projectId);
  return { success: true };
}

export async function updateProjectOffering(projectId: string, serviceOfferingId: string | null) {
  const user = await requireAuth();
  requireAdminOrManager(user.role);

  await db.project.update({
    where: { id: projectId },
    data: { serviceOfferingId },
  });

  await logActivity("updated", "project", projectId, user.id, "Updated service offering");
  revalidatePath("/team");
  return { success: true };
}

// Role Definition CRUD
export async function createRoleDefinition(name: string) {
  const user = await requireAuth();
  requireAdminOrManager(user.role);

  if (!name.trim()) return { error: "Name is required" };

  const existing = await db.roleDefinition.findUnique({ where: { name: name.trim() } });
  if (existing) return { error: "Role already exists", id: existing.id };

  const rd = await db.roleDefinition.create({ data: { name: name.trim() } });
  await logActivity("created", "roleDefinition", rd.id, user.id, rd.name);
  revalidatePath("/team");
  return { success: true, id: rd.id };
}

// Project Role CRUD
export async function createProjectRole(projectId: string, roleDefinitionId: string, requiredFte: number, quantity: number) {
  const user = await requireAuth();
  requireAdminOrManager(user.role);

  if (!projectId || !roleDefinitionId) return { error: "Project and role are required" };
  if (requiredFte < 0 || requiredFte > 2) return { error: "FTE must be between 0 and 2" };
  if (quantity < 1 || quantity > 50) return { error: "Quantity must be between 1 and 50" };

  const pr = await db.projectRole.create({
    data: { projectId, roleDefinitionId, requiredFte, quantity },
  });
  await logActivity("created", "projectRole", pr.id, user.id, `Added role to project`);
  revalidateAssignmentPaths(null, projectId);
  return { success: true, id: pr.id };
}

export async function updateProjectRole(id: string, requiredFte: number, quantity: number) {
  const user = await requireAuth();
  requireAdminOrManager(user.role);

  const updated = await db.projectRole.update({
    where: { id },
    data: { requiredFte, quantity },
    select: { projectId: true },
  });
  await logActivity("updated", "projectRole", id, user.id);
  revalidateAssignmentPaths(null, updated.projectId);
  return { success: true };
}

export async function deleteProjectRole(id: string) {
  const user = await requireAuth();
  requireAdminOrManager(user.role);

  const pr = await db.projectRole.findUnique({ where: { id }, select: { projectId: true } });
  // Unlink assignments from this project role before deleting
  await db.assignment.updateMany({ where: { projectRoleId: id }, data: { projectRoleId: null } });
  await db.projectRole.delete({ where: { id } });
  await logActivity("deleted", "projectRole", id, user.id);
  revalidateAssignmentPaths(null, pr?.projectId);
  return { success: true };
}

// Service Offering CRUD
const serviceOfferingSchema = z.object({
  name: z.string().min(1, "Name is required"),
  description: z.string().optional(),
});

export async function createServiceOffering(_prev: unknown, formData: FormData) {
  const user = await requireAuth();
  requireAdminOrManager(user.role);

  const parsed = serviceOfferingSchema.safeParse({
    name: formData.get("name"),
    description: formData.get("description") || undefined,
  });

  if (!parsed.success) return { error: "Invalid input" };

  const existing = await db.serviceOffering.findUnique({ where: { name: parsed.data.name } });
  if (existing) return { error: "Service offering already exists" };

  const so = await db.serviceOffering.create({ data: parsed.data });
  await logActivity("created", "serviceOffering", so.id, user.id, so.name);
  revalidatePath("/team");
  return { success: true };
}
