"use server";

import { db } from "@/lib/db";
import { log } from "@/lib/log";
import { requireAuth, canManageProjectAssignments } from "@/lib/permissions";
import { hasOrgWideManage } from "@/lib/scope";
import { logActivity } from "@/lib/activity";
import { revalidatePath } from "next/cache";
import { revalidateAssignment } from "@/lib/revalidate-entity";
import { notify } from "@/lib/notifications";
import { absoluteUrl } from "@/lib/url";
import { z } from "zod";

/**
 * Notify an employee that they've been assigned to (or removed from) a
 * project. Best-effort — failures are logged but never bubble up because
 * notifications must not break the underlying mutation.
 */
async function notifyAssignmentChange(opts: {
  type: "assignment-created" | "assignment-removed";
  employeeId: string;
  actorId: string;
  projectId: string | null;
  assignmentId: string;
  role: string | null;
  fte: number;
}) {
  // Don't notify the actor about their own action
  if (opts.employeeId === opts.actorId) return;

  try {
    const [project, employee] = await Promise.all([
      opts.projectId
        ? db.project.findFirst({
            where: { id: opts.projectId, deletedAt: null },
            select: { name: true },
          })
        : Promise.resolve(null),
      db.user.findUnique({
        where: { id: opts.employeeId },
        select: { name: true, hasLoginAccess: true, isActive: true },
      }),
    ]);

    if (!employee) return;
    // Tracked-only employees (synthetic nologin-…@internal.local rows)
    // can never read an in-app notification, and "assignment-created"
    // emails would go to a placeholder address. Same for deactivated
    // accounts. Mirrors the filter in comments.ts notifyMentions.
    if (!employee.hasLoginAccess || !employee.isActive) return;

    const projectName = project?.name || "an internal assignment";
    const heading =
      opts.type === "assignment-created"
        ? `You were assigned to ${projectName}`
        : `You were removed from ${projectName}`;
    const detailParts = [
      opts.role ? `Role: ${opts.role}` : null,
      `${opts.fte.toFixed(2)} FTE`,
    ].filter(Boolean);
    const body = detailParts.join(" · ");

    const href = opts.projectId ? `/projects/${opts.projectId}` : `/team/${opts.employeeId}`;

    await notify({
      recipientId: opts.employeeId,
      type: opts.type,
      title: heading,
      body,
      href,
      actorId: opts.actorId,
      entityType: "assignment",
      entityId: opts.assignmentId,
      // Only email assignment-created — removal feels awkward via email
      // and the in-app bell already covers it.
      email:
        opts.type === "assignment-created"
          ? {
              templateKey: "notification",
              data: {
                recipientName: employee.name,
                heading,
                body,
                cta: { label: "View details", url: absoluteUrl(href) },
              },
            }
          : undefined,
    });
  } catch (err) {
    log.error("assignments.notify", "Notify failed", err);
  }
}

/**
 * Coarse role gate used by actions that aren't tied to one specific project
 * (e.g. service offerings, role definitions, generic "can this user reach
 * any staffing action at all"). Per-project gating uses
 * canManageProjectAssignments so a manager can only touch their projects.
 *
 * Returns a structured error rather than throwing so callers — which are
 * server actions invoked via useFormState — can surface it inline instead
 * of crashing to a Next.js 500 page.
 */
function requireAssignmentManager(role: string): { error: string } | null {
  if (role !== "ADMIN" && role !== "DEVELOPER" && role !== "MANAGER") {
    return { error: "Assignment manager access required" };
  }
  return null;
}

/**
 * Returns a structured error if the current user (by role + id) can't
 * manage assignments on the given project, otherwise null. ADMIN and
 * DEVELOPER always pass; MANAGER must be assigned to the project.
 * Internal-only (no project) assignments still require the coarse gate —
 * a contributor isn't allowed to create them.
 */
async function requireManageForAssignment(
  userId: string,
  role: string,
  projectId: string | null | undefined
): Promise<{ error: string } | null> {
  if (hasOrgWideManage(role as Parameters<typeof hasOrgWideManage>[0])) {
    return null;
  }
  if (role !== "MANAGER") return { error: "Permission denied" };
  if (!projectId) return { error: "Permission denied" };
  const ok = await canManageProjectAssignments(
    userId,
    role as Parameters<typeof canManageProjectAssignments>[1],
    projectId
  );
  if (!ok) return { error: "Permission denied" };
  return null;
}

// Revalidate all paths where an assignment could appear.
// Local alias for the central helper to keep existing call sites short.
function revalidateAssignmentPaths(employeeId?: string | null, projectId?: string | null) {
  revalidateAssignment({ employeeId, projectId });
}

/**
 * Per-row gate for inline staffing-matrix edits: load the assignment,
 * then require manage rights on the project it currently belongs to.
 * Without this, the inline actions only applied the coarse role gate —
 * any MANAGER could edit any project's staffing rows org-wide.
 */
async function gateAssignmentById(
  userId: string,
  role: string,
  assignmentId: string
): Promise<{ error: string } | null> {
  if (!assignmentId) return { error: "Assignment ID is required" };
  const existing = await db.assignment.findUnique({
    where: { id: assignmentId },
    select: { projectId: true },
  });
  if (!existing) return { error: "Assignment not found" };
  return requireManageForAssignment(userId, role, existing.projectId);
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
  const gate = requireAssignmentManager(user.role);
  if (gate) return gate;

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

  // Managers may only assign to projects they themselves are on.
  const projectGate = await requireManageForAssignment(user.id, user.role, parsed.data.projectId);
  if (projectGate) return projectGate;

  const assignment = await db.assignment.create({
    data: {
      ...parsed.data,
      startDate: parsed.data.startDate ? new Date(parsed.data.startDate) : undefined,
      endDate: parsed.data.endDate ? new Date(parsed.data.endDate) : undefined,
    },
  });

  await logActivity("created", "assignment", assignment.id, user.id, `Assignment for employee ${parsed.data.employeeId}`, {
    projectId: assignment.projectId,
    clientId: assignment.clientId,
  });
  revalidateAssignmentPaths(parsed.data.employeeId, parsed.data.projectId);
  await notifyAssignmentChange({
    type: "assignment-created",
    employeeId: assignment.employeeId,
    actorId: user.id,
    projectId: assignment.projectId,
    assignmentId: assignment.id,
    role: assignment.role,
    fte: assignment.allocationFte,
  });

  // Fire PROJECT_ASSIGNMENT workflow triggers — e.g. send the assigned
  // user a project-welcome workflow with links + onboarding details.
  // Failure here doesn't roll back the assignment; a stuck workflow
  // is recoverable, an unmade assignment isn't.
  if (assignment.projectId) {
    try {
      const { fireProjectAssignmentTriggers } = await import(
        "@/lib/workflows/triggers"
      );
      await fireProjectAssignmentTriggers({
        userId: assignment.employeeId,
        projectId: assignment.projectId,
        serviceOfferingId: assignment.serviceOfferingId,
        createdById: user.id,
      });
    } catch (err) {
      log.error("assignments.triggers", "project-assignment trigger failed", err);
    }
  }

  return { success: true };
}

export async function updateAssignment(_prev: unknown, formData: FormData) {
  const user = await requireAuth();
  const gate = requireAssignmentManager(user.role);
  if (gate) return gate;

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

  const previous = await db.assignment.findUnique({
    where: { id },
    select: { status: true, employeeId: true, projectId: true },
  });
  if (!previous) return { error: "Assignment not found" };

  // Gate on the assignment's CURRENT project first — checking only the
  // submitted projectId would let a manager on project A hijack any
  // assignment org-wide by posting projectId=A. Then gate the
  // destination project too.
  const currentGate = await requireManageForAssignment(user.id, user.role, previous.projectId);
  if (currentGate) return currentGate;
  const projectGate = await requireManageForAssignment(user.id, user.role, parsed.data.projectId);
  if (projectGate) return projectGate;

  await db.assignment.update({
    where: { id },
    data: {
      ...parsed.data,
      startDate: parsed.data.startDate ? new Date(parsed.data.startDate) : null,
      endDate: parsed.data.endDate ? new Date(parsed.data.endDate) : null,
    },
  });

  await logActivity("updated", "assignment", id, user.id, undefined, {
    projectId: parsed.data.projectId,
    clientId: parsed.data.clientId,
  });
  revalidateAssignmentPaths(parsed.data.employeeId, parsed.data.projectId);
  // Entity-map rule 4: when FKs change, the pages the assignment moved
  // AWAY from need revalidating too.
  if (
    previous.employeeId !== parsed.data.employeeId ||
    previous.projectId !== (parsed.data.projectId ?? null)
  ) {
    revalidateAssignmentPaths(previous.employeeId, previous.projectId);
  }
  return { success: true };
}

export async function deleteAssignment(_prev: unknown, formData: FormData) {
  const user = await requireAuth();
  const gate = requireAssignmentManager(user.role);
  if (gate) return gate;

  const id = formData.get("id") as string;
  if (!id) return { error: "Assignment ID is required" };

  const assignment = await db.assignment.findUnique({
    where: { id },
    select: { employeeId: true, projectId: true, clientId: true },
  });
  if (!assignment) return { error: "Assignment not found" };
  const projectGate = await requireManageForAssignment(user.id, user.role, assignment.projectId);
  if (projectGate) return projectGate;

  await db.assignment.delete({ where: { id } });
  await logActivity("deleted", "assignment", id, user.id, undefined, {
    projectId: assignment.projectId,
    clientId: assignment.clientId,
  });
  revalidateAssignmentPaths(assignment.employeeId, assignment.projectId);
  return { success: true };
}

// Direct delete (for inline remove from staffing matrix)
export async function removeAssignment(assignmentId: string) {
  const user = await requireAuth();
  const gate = requireAssignmentManager(user.role);
  if (gate) return gate;

  if (!assignmentId) return { error: "Assignment ID is required" };

  // Look up the assignment first so we can revalidate specific detail pages
  // and notify the (former) assignee
  const assignment = await db.assignment.findUnique({
    where: { id: assignmentId },
    select: { employeeId: true, projectId: true, clientId: true, role: true, allocationFte: true },
  });
  if (!assignment) return { error: "Assignment not found" };
  const projectGate = await requireManageForAssignment(user.id, user.role, assignment.projectId);
  if (projectGate) return projectGate;

  await db.assignment.delete({ where: { id: assignmentId } });
  await logActivity("deleted", "assignment", assignmentId, user.id, undefined, {
    projectId: assignment.projectId,
    clientId: assignment.clientId,
  });
  revalidateAssignmentPaths(assignment.employeeId, assignment.projectId);
  await notifyAssignmentChange({
    type: "assignment-removed",
    employeeId: assignment.employeeId,
    actorId: user.id,
    projectId: assignment.projectId,
    assignmentId,
    role: assignment.role,
    fte: assignment.allocationFte,
  });
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
  const gate = requireAssignmentManager(user.role);
  if (gate) return gate;

  if (!data.employeeId || !data.projectId) return { error: "Employee and project are required" };
  // Same bounds as assignmentSchema / updateAssignmentFte — quickAssign
  // used to be the one path with no FTE validation.
  if (
    typeof data.allocationFte !== "number" ||
    Number.isNaN(data.allocationFte) ||
    data.allocationFte < 0 ||
    data.allocationFte > 2
  ) {
    return { error: "FTE must be between 0 and 2" };
  }
  const projectGate = await requireManageForAssignment(user.id, user.role, data.projectId);
  if (projectGate) return projectGate;

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

  await logActivity("created", "assignment", assignment.id, user.id, `Quick-assigned to project`, {
    projectId: assignment.projectId,
    clientId: assignment.clientId,
  });
  revalidateAssignmentPaths(data.employeeId, data.projectId);
  await notifyAssignmentChange({
    type: "assignment-created",
    employeeId: assignment.employeeId,
    actorId: user.id,
    projectId: assignment.projectId,
    assignmentId: assignment.id,
    role: assignment.role,
    fte: assignment.allocationFte,
  });

  if (assignment.projectId) {
    try {
      const { fireProjectAssignmentTriggers } = await import(
        "@/lib/workflows/triggers"
      );
      await fireProjectAssignmentTriggers({
        userId: assignment.employeeId,
        projectId: assignment.projectId,
        serviceOfferingId: assignment.serviceOfferingId,
        createdById: user.id,
      });
    } catch (err) {
      log.error("assignments.triggers", "project-assignment trigger failed", err);
    }
  }

  return { success: true };
}

// Inline field updates (for staffing matrix direct editing)
export async function updateAssignmentNotes(assignmentId: string, notes: string) {
  const user = await requireAuth();
  const gate = requireAssignmentManager(user.role);
  if (gate) return gate;
  const rowGate = await gateAssignmentById(user.id, user.role, assignmentId);
  if (rowGate) return rowGate;

  const updated = await db.assignment.update({
    where: { id: assignmentId },
    data: { notes: notes || null },
    select: { employeeId: true, projectId: true, clientId: true },
  });

  await logActivity("updated", "assignment", assignmentId, user.id, "Updated notes", {
    projectId: updated.projectId,
    clientId: updated.clientId,
  });
  revalidateAssignmentPaths(updated.employeeId, updated.projectId);
  return { success: true };
}

export async function updateAssignmentRole(assignmentId: string, role: string, roleDefinitionId: string | null) {
  const user = await requireAuth();
  const gate = requireAssignmentManager(user.role);
  if (gate) return gate;
  const rowGate = await gateAssignmentById(user.id, user.role, assignmentId);
  if (rowGate) return rowGate;

  // Look up the assignment's project so we can re-link projectRoleId
  // to a matching ProjectRole on the same project (if one exists).
  // Otherwise the row stays bound to the old ProjectRole group.
  const existing = await db.assignment.findUnique({
    where: { id: assignmentId },
    select: { projectId: true },
  });

  let newProjectRoleId: string | null = null;
  if (existing?.projectId && roleDefinitionId) {
    const matching = await db.projectRole.findFirst({
      where: { projectId: existing.projectId, roleDefinitionId },
      select: { id: true },
    });
    newProjectRoleId = matching?.id || null;
  }

  const updated = await db.assignment.update({
    where: { id: assignmentId },
    data: {
      role: role || null,
      roleDefinitionId,
      projectRoleId: newProjectRoleId,
    },
    select: { employeeId: true, projectId: true, clientId: true },
  });

  await logActivity("updated", "assignment", assignmentId, user.id, `Updated role to ${role}`, {
    projectId: updated.projectId,
    clientId: updated.clientId,
  });
  revalidateAssignmentPaths(updated.employeeId, updated.projectId);
  return { success: true };
}

export async function updateAssignmentFte(assignmentId: string, allocationFte: number) {
  const user = await requireAuth();
  const gate = requireAssignmentManager(user.role);
  if (gate) return gate;

  if (allocationFte < 0 || allocationFte > 2) return { error: "FTE must be between 0 and 2" };
  const rowGate = await gateAssignmentById(user.id, user.role, assignmentId);
  if (rowGate) return rowGate;

  const updated = await db.assignment.update({
    where: { id: assignmentId },
    data: { allocationFte },
    select: { employeeId: true, projectId: true, clientId: true },
  });

  await logActivity("updated", "assignment", assignmentId, user.id, `Updated FTE to ${allocationFte}`, {
    projectId: updated.projectId,
    clientId: updated.clientId,
  });
  revalidateAssignmentPaths(updated.employeeId, updated.projectId);
  return { success: true };
}

export async function updateProjectOffering(projectId: string, serviceOfferingId: string | null) {
  const user = await requireAuth();
  const gate = requireAssignmentManager(user.role);
  if (gate) return gate;
  const projectGate = await requireManageForAssignment(user.id, user.role, projectId);
  if (projectGate) return projectGate;

  const project = await db.project.findFirst({
    where: { id: projectId, deletedAt: null },
    select: { id: true },
  });
  if (!project) return { error: "Project not found" };

  await db.project.update({
    where: { id: projectId },
    data: { serviceOfferingId },
  });

  await logActivity("updated", "project", projectId, user.id, "Updated service offering", {
    projectId,
  });
  revalidatePath("/team");
  return { success: true };
}

// Role Definition CRUD
export async function createRoleDefinition(name: string) {
  const user = await requireAuth();
  const gate = requireAssignmentManager(user.role);
  if (gate) return gate;

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
  const gate = requireAssignmentManager(user.role);
  if (gate) return gate;

  if (!projectId || !roleDefinitionId) return { error: "Project and role are required" };
  if (requiredFte < 0 || requiredFte > 2) return { error: "FTE must be between 0 and 2" };
  if (quantity < 1 || quantity > 50) return { error: "Quantity must be between 1 and 50" };
  const projectGate = await requireManageForAssignment(user.id, user.role, projectId);
  if (projectGate) return projectGate;

  const pr = await db.projectRole.create({
    data: { projectId, roleDefinitionId, requiredFte, quantity },
  });
  await logActivity("created", "projectRole", pr.id, user.id, `Added role to project`, { projectId });
  revalidateAssignmentPaths(null, projectId);
  return { success: true, id: pr.id };
}

export async function updateProjectRole(id: string, requiredFte: number, quantity: number) {
  const user = await requireAuth();
  const gate = requireAssignmentManager(user.role);
  if (gate) return gate;
  if (requiredFte < 0 || requiredFte > 2) return { error: "FTE must be between 0 and 2" };
  if (quantity < 1 || quantity > 50) return { error: "Quantity must be between 1 and 50" };

  const existing = await db.projectRole.findUnique({
    where: { id },
    select: { projectId: true },
  });
  if (!existing) return { error: "Role not found" };
  const projectGate = await requireManageForAssignment(user.id, user.role, existing.projectId);
  if (projectGate) return projectGate;

  const updated = await db.projectRole.update({
    where: { id },
    data: { requiredFte, quantity },
    select: { projectId: true },
  });
  await logActivity("updated", "projectRole", id, user.id, undefined, {
    projectId: updated.projectId,
  });
  revalidateAssignmentPaths(null, updated.projectId);
  return { success: true };
}

export async function deleteProjectRole(id: string) {
  const user = await requireAuth();
  const gate = requireAssignmentManager(user.role);
  if (gate) return gate;

  const pr = await db.projectRole.findUnique({ where: { id }, select: { projectId: true } });
  if (!pr) return { error: "Role not found" };
  const projectGate = await requireManageForAssignment(user.id, user.role, pr.projectId);
  if (projectGate) return projectGate;
  // Unlink assignments from this project role before deleting, atomically
  // with the delete so a failure can't leave rows pointing at a gone role.
  await db.$transaction([
    db.assignment.updateMany({ where: { projectRoleId: id }, data: { projectRoleId: null } }),
    db.projectRole.delete({ where: { id } }),
  ]);
  await logActivity("deleted", "projectRole", id, user.id, undefined, {
    projectId: pr?.projectId,
  });
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
  const gate = requireAssignmentManager(user.role);
  if (gate) return gate;

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
