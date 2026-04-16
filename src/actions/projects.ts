"use server";

import { db } from "@/lib/db";
import { requireAuth, resolveModulePerms, canManageAssignments } from "@/lib/permissions";
import { logActivity } from "@/lib/activity";
import { revalidatePath } from "next/cache";
import { revalidateProject, revalidateUser } from "@/lib/revalidate-entity";
import { notify } from "@/lib/notifications";
import { absoluteUrl } from "@/lib/url";
import { z } from "zod";

const projectSchema = z.object({
  name: z.string().min(1, "Name is required"),
  description: z.string().optional(),
  status: z.enum(["PLANNING", "ACTIVE", "ON_HOLD", "COMPLETED", "ARCHIVED"]).optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  clientId: z.string().min(1, "Client is required"),
  parentProjectId: z.string().optional(),
  serviceOfferingId: z.string().optional(),
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
    await logActivity("created", "client", newClient.id, user.id, newClient.name);
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

  await logActivity("created", "project", project.id, user.id, project.name);
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

  await logActivity("updated", "project", id, user.id, parsed.data.name);
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
  await logActivity("deleted", "project", id, user.id, project.name);
  revalidateProject(id, { clientId: project.clientId });
  return { success: true };
}

// Members
export async function addProjectMember(_prev: unknown, formData: FormData) {
  const user = await requireAuth();
  // Only admins and managers can assign people to projects. This keeps
  // scoped access (getUserScope) under central control — a contributor
  // can't grant themselves (or a peer) access to additional projects.
  if (!canManageAssignments(user.role)) return { error: "Permission denied" };

  const projectId = formData.get("projectId") as string;
  const userId = formData.get("userId") as string;
  const role = (formData.get("role") as string) || "CONTRIBUTOR";

  const existing = await db.projectMember.findUnique({
    where: { userId_projectId: { userId, projectId } },
  });
  if (existing) return { error: "User is already a member" };

  await db.projectMember.create({
    data: { userId, projectId, role: role as "ADMIN" | "MANAGER" | "CONTRIBUTOR" | "VIEWER" },
  });

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
      // eslint-disable-next-line no-console
      console.error("[projects] addProjectMember notify failed:", err);
    }
  }

  return { success: true };
}

export async function removeProjectMember(_prev: unknown, formData: FormData) {
  const user = await requireAuth();
  if (!canManageAssignments(user.role)) return { error: "Permission denied" };

  const id = formData.get("id") as string;
  // Look up what we're removing so we can revalidate the specific project detail
  // page and the specific user's team profile (both show the membership).
  const member = await db.projectMember.findUnique({
    where: { id },
    select: { projectId: true, userId: true },
  });
  await db.projectMember.delete({ where: { id } });
  if (member?.projectId) revalidatePath(`/projects/${member.projectId}`);
  if (member?.userId) revalidateUser(member.userId);
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
      // eslint-disable-next-line no-console
      console.error("[projects] addMilestoneAssignee notify failed:", err);
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
