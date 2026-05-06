"use server";

import { db } from "@/lib/db";
import { log } from "@/lib/log";
import { requireAuth, resolveModulePerms, canManageProjectAssignments } from "@/lib/permissions";
import { maybePromoteUserRole, maybeDemoteUserRole } from "@/lib/auto-role";
import { logActivity } from "@/lib/activity";
import { revalidatePath } from "next/cache";
import { revalidateProject, revalidateUser } from "@/lib/revalidate-entity";
import { notify } from "@/lib/notifications";
import { absoluteUrl } from "@/lib/url";
import { z } from "zod";
import { isValidCalendarRange } from "@/lib/dates";
import { nameField } from "@/lib/validation";

const projectSchema = z
  .object({
    name: nameField({ label: "Name" }),
    description: z.string().optional(),
    status: z.enum(["PLANNING", "ACTIVE", "ON_HOLD", "COMPLETED", "ARCHIVED"]).optional(),
    startDate: z.string().optional(),
    endDate: z.string().optional(),
    clientId: z.string().min(1, "Client is required"),
    parentProjectId: z.string().optional(),
    serviceOfferingId: z.string().optional(),
  })
  .refine((d) => isValidCalendarRange(d.startDate, d.endDate), {
    message: "End date must be on or after start date",
    path: ["endDate"],
  });

export async function createProject(_prev: unknown, formData: FormData) {
  const user = await requireAuth();
  const perms = await resolveModulePerms(user.id, user.role, "projects");
  if (!perms.canCreate) return { error: "Permission denied" };

  // Handle inline client creation
  let clientId = formData.get("clientId") as string;
  const newClientName = (formData.get("newClientName") as string)?.trim();

  if (!clientId && newClientName) {
    const newClient = await db.client.create({
      data: { name: newClientName, status: "ACTIVE" },
    });
    clientId = newClient.id;
    await logActivity("created", "client", newClient.id, user.id, newClient.name, { clientId: newClient.id });
  }

  // Handle inline service offering creation — same pattern as inline client.
  // If the user picked "+ Add new..." and typed a name, create the offering
  // first so it's in the dropdown's list for future forms.
  let serviceOfferingId = formData.get("serviceOfferingId") as string;
  const newServiceOfferingName = (formData.get("newServiceOfferingName") as string)?.trim();

  if ((!serviceOfferingId || serviceOfferingId === "__new__") && newServiceOfferingName) {
    // Reuse an existing offering by name if one already exists (case-insensitive)
    // so duplicate typing doesn't create parallel rows
    const existing = await db.serviceOffering.findFirst({
      where: { name: { equals: newServiceOfferingName, mode: "insensitive" } },
    });
    if (existing) {
      serviceOfferingId = existing.id;
    } else {
      const newOffering = await db.serviceOffering.create({
        data: { name: newServiceOfferingName, isActive: true },
      });
      serviceOfferingId = newOffering.id;
      await logActivity("created", "serviceOffering", newOffering.id, user.id, newOffering.name);
    }
  } else if (serviceOfferingId === "__new__") {
    // Sentinel left over without a name — treat as no selection
    serviceOfferingId = "";
  }

  const parsed = projectSchema.safeParse({
    name: formData.get("name"),
    description: formData.get("description") || undefined,
    status: formData.get("status") || "PLANNING",
    startDate: formData.get("startDate") || undefined,
    endDate: formData.get("endDate") || undefined,
    clientId,
    parentProjectId: formData.get("parentProjectId") || undefined,
    serviceOfferingId: serviceOfferingId || undefined,
  });

  if (!parsed.success) return { error: "Invalid input", fieldErrors: parsed.error.flatten().fieldErrors };

  const data = {
    ...parsed.data,
    startDate: parsed.data.startDate ? new Date(parsed.data.startDate) : undefined,
    endDate: parsed.data.endDate ? new Date(parsed.data.endDate) : undefined,
    parentProjectId: parsed.data.parentProjectId || undefined,
  };

  const project = await db.project.create({ data });

  // Auto-add creator as a member
  await db.projectMember.create({
    data: { userId: user.id, projectId: project.id, role: user.role },
  });

  // Create related project links
  const relatedIds = formData.getAll("relatedProjectIds") as string[];
  if (relatedIds.length > 0) {
    await db.projectRelation.createMany({
      data: relatedIds.map((relatedProjectId) => ({
        projectId: project.id,
        relatedProjectId,
      })),
      skipDuplicates: true,
    });
  }

  await logActivity("created", "project", project.id, user.id, project.name, {
    projectId: project.id,
    clientId: project.clientId,
  });
  revalidateProject(project.id, { clientId: project.clientId });
  return { success: true };
}

export async function updateProject(_prev: unknown, formData: FormData) {
  const user = await requireAuth();
  const perms = await resolveModulePerms(user.id, user.role, "projects");
  if (!perms.canEdit) return { error: "Permission denied" };

  const id = formData.get("id") as string;

  // Handle inline service offering creation on edit too — same pattern
  // as createProject.
  let serviceOfferingId = formData.get("serviceOfferingId") as string;
  const newServiceOfferingName = (formData.get("newServiceOfferingName") as string)?.trim();

  if ((!serviceOfferingId || serviceOfferingId === "__new__") && newServiceOfferingName) {
    const existing = await db.serviceOffering.findFirst({
      where: { name: { equals: newServiceOfferingName, mode: "insensitive" } },
    });
    if (existing) {
      serviceOfferingId = existing.id;
    } else {
      const newOffering = await db.serviceOffering.create({
        data: { name: newServiceOfferingName, isActive: true },
      });
      serviceOfferingId = newOffering.id;
      await logActivity("created", "serviceOffering", newOffering.id, user.id, newOffering.name);
    }
  } else if (serviceOfferingId === "__new__") {
    serviceOfferingId = "";
  }

  const parsed = projectSchema.safeParse({
    name: formData.get("name"),
    description: formData.get("description") || undefined,
    status: formData.get("status") || undefined,
    startDate: formData.get("startDate") || undefined,
    endDate: formData.get("endDate") || undefined,
    clientId: formData.get("clientId"),
    parentProjectId: formData.get("parentProjectId") || undefined,
    serviceOfferingId: serviceOfferingId || undefined,
  });

  if (!parsed.success) return { error: "Invalid input", fieldErrors: parsed.error.flatten().fieldErrors };

  // Look up the previous clientId so we can revalidate the old client's page too
  // if the client changed (the old client's project list needs to drop this project).
  const previous = await db.project.findUnique({
    where: { id },
    select: { clientId: true },
  });

  await db.project.update({
    where: { id },
    data: {
      ...parsed.data,
      startDate: parsed.data.startDate ? new Date(parsed.data.startDate) : null,
      endDate: parsed.data.endDate ? new Date(parsed.data.endDate) : null,
      parentProjectId: parsed.data.parentProjectId || null,
      serviceOfferingId: parsed.data.serviceOfferingId || null,
    },
  });

  // Sync related-project links. The Edit dialog (mirroring the Create
  // dialog's parity per the QA report) posts the full set of
  // relatedProjectIds it wants the project to have. We replace the
  // current set: drop any link that's no longer present and create the
  // missing ones. Self-references and the existing parentProjectId are
  // filtered out so the form can't accidentally create a cycle.
  const desiredRelated = (formData.getAll("relatedProjectIds") as string[])
    .filter((rid) => rid && rid !== id && rid !== parsed.data.parentProjectId);

  const existingRelated = await db.projectRelation.findMany({
    where: { projectId: id },
    select: { id: true, relatedProjectId: true },
  });
  const existingByRelatedId = new Map(
    existingRelated.map((r) => [r.relatedProjectId, r.id])
  );
  const desiredSet = new Set(desiredRelated);

  // Drop links that aren't in the new set.
  const toDelete = existingRelated
    .filter((r) => !desiredSet.has(r.relatedProjectId))
    .map((r) => r.id);
  if (toDelete.length > 0) {
    await db.projectRelation.deleteMany({ where: { id: { in: toDelete } } });
  }

  // Create the new ones, skipping any that already exist.
  const toCreate = desiredRelated
    .filter((rid) => !existingByRelatedId.has(rid))
    .map((rid) => ({ projectId: id, relatedProjectId: rid }));
  if (toCreate.length > 0) {
    await db.projectRelation.createMany({
      data: toCreate,
      skipDuplicates: true,
    });
  }

  await logActivity("updated", "project", id, user.id, parsed.data.name, {
    projectId: id,
    clientId: parsed.data.clientId,
  });
  revalidateProject(id, {
    clientId: parsed.data.clientId,
    previousClientId: previous?.clientId ?? null,
  });
  return { success: true };
}

export async function deleteProject(_prev: unknown, formData: FormData) {
  const user = await requireAuth();
  const perms = await resolveModulePerms(user.id, user.role, "projects");
  if (!perms.canDelete) return { error: "Permission denied" };

  const id = formData.get("id") as string;
  const project = await db.project.findUnique({ where: { id } });
  if (!project) return { error: "Project not found" };

  await db.project.delete({ where: { id } });
  await logActivity("deleted", "project", id, user.id, project.name, {
    projectId: id,
    clientId: project.clientId,
  });
  // deleted: true skips revalidating /projects/${id} so the [projectId]
  // RSC tree (which the user is currently on) doesn't auto-refresh
  // against the now-missing record before the client navigates away.
  revalidateProject(id, { clientId: project.clientId, deleted: true });
  return { success: true };
}

// Members

// Allowed values for ProjectMember.role. The form previously cast
// whatever string came in straight to the enum, so an attacker could
// pass `role: "ADMIN"` and end up labeled an admin on the project
// (which the legacy member-role code paths read in some places, and
// which shows up in the UI as "Admin").
const PROJECT_MEMBER_ROLES = ["ADMIN", "MANAGER", "DEVELOPER", "CONTRIBUTOR", "VIEWER"] as const;
type ProjectMemberRole = (typeof PROJECT_MEMBER_ROLES)[number];

// Roles ranked for the "actor can't grant a higher role than their own"
// check. ADMIN/DEVELOPER (org-wide manage) can grant anything; everyone
// else is bounded by their own level.
const ROLE_RANK: Record<ProjectMemberRole, number> = {
  ADMIN: 4,
  DEVELOPER: 4,
  MANAGER: 3,
  CONTRIBUTOR: 2,
  VIEWER: 1,
};

export async function addProjectMember(_prev: unknown, formData: FormData) {
  const user = await requireAuth();

  const projectId = formData.get("projectId") as string;
  const userId = formData.get("userId") as string;
  const roleRaw = (formData.get("role") as string | null)?.trim().toUpperCase() || "CONTRIBUTOR";

  // Validate role against the closed enum BEFORE any DB writes.
  if (!PROJECT_MEMBER_ROLES.includes(roleRaw as ProjectMemberRole)) {
    return {
      error: `Invalid role "${roleRaw}". Must be one of: ${PROJECT_MEMBER_ROLES.join(", ")}`,
    };
  }
  const role = roleRaw as ProjectMemberRole;

  // Only admins, developers, and managers *assigned to this project* can
  // add members. A manager can't grow their own scope by adding themselves
  // to a project they're not already on.
  if (!(await canManageProjectAssignments(user.id, user.role, projectId)))
    return { error: "Permission denied" };

  // Refuse if the actor would be granting a higher role than their own.
  // ADMIN/DEVELOPER pass through (rank 4); MANAGER can't make someone
  // "ADMIN" on a project, etc.
  const actorRank = ROLE_RANK[user.role as ProjectMemberRole] ?? 0;
  const targetRank = ROLE_RANK[role];
  if (targetRank > actorRank) {
    return {
      error: `You can't grant a project role higher than your own (${user.role}).`,
    };
  }

  const existing = await db.projectMember.findUnique({
    where: { userId_projectId: { userId, projectId } },
  });
  if (existing) return { error: "User is already a member" };

  await db.projectMember.create({
    data: { userId, projectId, role },
  });

  // Bump GUEST / VIEWER up to CONTRIBUTOR now that they have project access.
  // Their previous role is stored so it can be restored if they lose every
  // assignment later.
  await maybePromoteUserRole(userId);

  revalidatePath(`/projects/${projectId}`);
  // The new member's /team/{userId} page shows project memberships, so it needs
  // to be revalidated too.
  revalidateUser(userId);

  // Notify the new member (skip if they added themselves)
  if (userId !== user.id) {
    try {
      const project = await db.project.findUnique({
        where: { id: projectId },
        select: { name: true },
      });
      if (project) {
        await notify({
          recipientId: userId,
          type: "project-updated",
          title: `Added to project: ${project.name}`,
          body: `You were added as a ${role.toLowerCase()} on ${project.name}.`,
          href: `/projects/${projectId}`,
          actorId: user.id,
          entityType: "project",
          entityId: projectId,
        });
      }
    } catch (err) {
      log.error("projects.notify", "addProjectMember notify failed", err);
    }
  }

  // Fire PROJECT_ASSIGNMENT triggers for legacy ProjectMember-based
  // assignments too. createAssignment fires its own; both code paths
  // reach the same helper so a workflow author who configures the
  // trigger doesn't have to know which mechanism added the member.
  try {
    const project = await db.project.findUnique({
      where: { id: projectId },
      select: { serviceOfferingId: true },
    });
    const { fireProjectAssignmentTriggers } = await import(
      "@/lib/workflows/triggers"
    );
    await fireProjectAssignmentTriggers({
      userId,
      projectId,
      serviceOfferingId: project?.serviceOfferingId ?? null,
      createdById: user.id,
    });
  } catch (err) {
    log.error("projects.triggers", "project-assignment trigger failed", err);
  }

  return { success: true };
}

export async function removeProjectMember(_prev: unknown, formData: FormData) {
  const user = await requireAuth();

  const id = formData.get("id") as string;
  // Look up what we're removing so we can revalidate the specific project detail
  // page and the specific user's team profile (both show the membership).
  const member = await db.projectMember.findUnique({
    where: { id },
    select: { projectId: true, userId: true },
  });
  if (!member) return { error: "Member not found" };
  if (!(await canManageProjectAssignments(user.id, user.role, member.projectId)))
    return { error: "Permission denied" };

  await db.projectMember.delete({ where: { id } });
  // If this was the last thing keeping the user at CONTRIBUTOR (auto-promoted),
  // revert them to their original role.
  await maybeDemoteUserRole(member.userId);
  revalidatePath(`/projects/${member.projectId}`);
  revalidateUser(member.userId);
  return { success: true };
}

// Milestones
const milestoneSchema = z.object({
  title: z.string().min(1, "Title is required"),
  description: z.string().optional(),
  dueDate: z.string().optional(),
  projectId: z.string(),
});

export async function createMilestone(_prev: unknown, formData: FormData) {
  const user = await requireAuth();
  const perms = await resolveModulePerms(user.id, user.role, "projects");
  if (!perms.canCreate) return { error: "Permission denied" };

  const parsed = milestoneSchema.safeParse({
    title: formData.get("title"),
    description: formData.get("description") || undefined,
    dueDate: formData.get("dueDate") || undefined,
    projectId: formData.get("projectId"),
  });

  if (!parsed.success) return { error: "Invalid input", fieldErrors: parsed.error.flatten().fieldErrors };

  await db.milestone.create({
    data: {
      ...parsed.data,
      dueDate: parsed.data.dueDate ? new Date(parsed.data.dueDate) : undefined,
    },
  });

  revalidatePath(`/projects/${parsed.data.projectId}`);
  return { success: true };
}

export async function toggleMilestone(_prev: unknown, formData: FormData) {
  const user = await requireAuth();
  const perms = await resolveModulePerms(user.id, user.role, "projects");
  if (!perms.canEdit) return { error: "Permission denied" };

  const id = formData.get("id") as string;
  const milestone = await db.milestone.findUnique({ where: { id } });
  if (!milestone) return { error: "Not found" };

  await db.milestone.update({
    where: { id },
    data: {
      completed: !milestone.completed,
      completedAt: !milestone.completed ? new Date() : null,
    },
  });

  revalidatePath(`/projects/${milestone.projectId}`);
  return { success: true };
}

export async function deleteMilestone(_prev: unknown, formData: FormData) {
  const user = await requireAuth();
  const perms = await resolveModulePerms(user.id, user.role, "projects");
  if (!perms.canDelete) return { error: "Permission denied" };

  const id = formData.get("id") as string;
  const milestone = await db.milestone.findUnique({ where: { id } });
  if (!milestone) return { error: "Not found" };

  await db.milestone.delete({ where: { id } });
  revalidatePath(`/projects/${milestone.projectId}`);
  return { success: true };
}

export async function addMilestoneAssignee(_prev: unknown, formData: FormData) {
  const user = await requireAuth();
  const perms = await resolveModulePerms(user.id, user.role, "projects");
  if (!perms.canEdit) return { error: "Permission denied" };

  const milestoneId = formData.get("milestoneId") as string;
  const userId = formData.get("userId") as string;

  const existing = await db.milestoneAssignee.findUnique({
    where: { milestoneId_userId: { milestoneId, userId } },
  });
  if (existing) return { error: "Already assigned" };

  await db.milestoneAssignee.create({ data: { milestoneId, userId } });
  // Look up the milestone (including project + title) so we can revalidate
  // the right pages and notify the new assignee with useful context.
  const milestone = await db.milestone.findUnique({
    where: { id: milestoneId },
    select: {
      title: true,
      projectId: true,
      project: { select: { name: true } },
    },
  });
  if (milestone?.projectId) revalidatePath(`/projects/${milestone.projectId}`);
  revalidateUser(userId);

  // Notify the new assignee (skip self-assignment)
  if (milestone && userId !== user.id) {
    try {
      await notify({
        recipientId: userId,
        type: "milestone-assigned",
        title: `Milestone assigned: ${milestone.title}`,
        body: milestone.project ? `On ${milestone.project.name}` : undefined,
        href: milestone.projectId ? `/projects/${milestone.projectId}` : undefined,
        actorId: user.id,
        entityType: "milestone",
        entityId: milestoneId,
      });
    } catch (err) {
      log.error("projects.notify", "addMilestoneAssignee notify failed", err);
    }
  }

  return { success: true };
}

export async function removeMilestoneAssignee(_prev: unknown, formData: FormData) {
  const user = await requireAuth();
  const perms = await resolveModulePerms(user.id, user.role, "projects");
  if (!perms.canEdit) return { error: "Permission denied" };

  const id = formData.get("id") as string;
  // Look up the assignee (to get userId and milestone's project) before delete
  // so we can revalidate both the project and the user profile.
  const assignee = await db.milestoneAssignee.findUnique({
    where: { id },
    select: { userId: true, milestone: { select: { projectId: true } } },
  });
  await db.milestoneAssignee.delete({ where: { id } });
  if (assignee?.milestone?.projectId) revalidatePath(`/projects/${assignee.milestone.projectId}`);
  if (assignee?.userId) revalidateUser(assignee.userId);
  return { success: true };
}

// Tools
export async function linkToolToProject(_prev: unknown, formData: FormData) {
  const user = await requireAuth();
  const perms = await resolveModulePerms(user.id, user.role, "projects");
  if (!perms.canEdit) return { error: "Permission denied" };

  const projectId = formData.get("projectId") as string;
  const toolId = formData.get("toolId") as string;

  if (!projectId || !toolId) return { error: "Project and tool are required" };

  const existing = await db.projectTool.findUnique({
    where: { projectId_toolId: { projectId, toolId } },
  });
  if (existing) return { error: "Tool is already linked to this project" };

  await db.projectTool.create({ data: { projectId, toolId } });
  revalidatePath(`/projects/${projectId}`);
  return { success: true };
}
