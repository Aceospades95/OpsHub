"use server";

import { db } from "@/lib/db";
import { log } from "@/lib/log";
import { revalidateTask } from "@/lib/revalidate-entity";
import { notify } from "@/lib/notifications";
import { absoluteUrl } from "@/lib/url";
import { requireAuth, resolveModulePerms } from "@/lib/permissions";
import type { Role } from "@prisma/client";
import { z } from "zod";
import { nameField } from "@/lib/validation";
import { pushNewTaskToGoogle } from "@/lib/google-tasks/sync";

/**
 * Verify the actor is allowed to mutate this specific task. Without
 * this gate, any authenticated user could iterate task IDs and edit
 * or delete every task in the org — server actions are reachable via
 * direct POST regardless of UI gating.
 *
 * Allow when ANY of:
 *   - Actor is the assignee
 *   - Actor is the creator
 *   - Actor has canEdit on the parent project (via assignment / entity
 *     permission / org-wide manage)
 *   - Actor has canManage on the tasks module overall (admin-equivalent)
 *
 * Returns null on success or { error } on rejection.
 */
async function authorizeTaskMutation(
  user: { id: string; role: Role },
  taskId: string
): Promise<{ error: string } | null> {
  const task = await db.task.findFirst({
    where: { id: taskId, deletedAt: null },
    select: {
      assigneeId: true,
      createdById: true,
      projectId: true,
      clientId: true,
    },
  });
  if (!task) return { error: "Task not found" };

  // Org-wide manage (ADMIN / DEVELOPER) and the actor's own tasks
  // short-circuit fast.
  if (task.assigneeId === user.id || task.createdById === user.id) {
    return null;
  }
  const tasksPerms = await resolveModulePerms(user.id, user.role, "tasks");
  if (tasksPerms.canManage) return null;
  if (tasksPerms.canEdit && task.assigneeId === null) {
    // Unassigned tasks within scope are editable by anyone with edit
    // — covers "team can pick up backlog tickets" workflows.
    return null;
  }
  // Final fallback: project-level edit permission.
  if (task.projectId) {
    const projectPerms = await resolveModulePerms(
      user.id,
      user.role,
      "projects"
    );
    if (projectPerms.canEdit || projectPerms.canManage) return null;
  }
  return { error: "You don't have permission to edit this task." };
}

/**
 * Notify a user that they've been assigned a task. Best-effort — failures
 * are logged but never break the underlying mutation.
 */
async function notifyTaskAssigned(opts: {
  taskId: string;
  assigneeId: string;
  actorId: string;
  title: string;
  projectId: string | null;
}) {
  // Skip self-assignment
  if (opts.assigneeId === opts.actorId) return;

  try {
    const [assignee, project] = await Promise.all([
      db.user.findUnique({
        where: { id: opts.assigneeId },
        select: { name: true, hasLoginAccess: true },
      }),
      opts.projectId
        ? db.project.findFirst({
            where: { id: opts.projectId, deletedAt: null },
            select: { name: true },
          })
        : Promise.resolve(null),
    ]);

    if (!assignee) return;

    const heading = `Task assigned: ${opts.title}`;
    const body = project ? `On ${project.name}` : "Standalone task";
    // Deep-link straight to the task: /tasks#task-<id> scrolls to the
    // row and opens its drawer. (Assignees always pass the /tasks scope
    // filter for their own tasks.)
    const href = `/tasks#task-${opts.taskId}`;

    await notify({
      recipientId: opts.assigneeId,
      type: "task-assigned",
      title: heading,
      body,
      href,
      actorId: opts.actorId,
      entityType: "task",
      entityId: opts.taskId,
      email: {
        templateKey: "notification",
        data: {
          recipientName: assignee.name,
          heading,
          body: project
            ? `You were assigned a task on ${project.name}: ${opts.title}`
            : `You were assigned a task: ${opts.title}`,
          cta: { label: "View task", url: absoluteUrl(href) },
        },
      },
    });
  } catch (err) {
    log.error("tasks.notify", "Notify failed", err);
  }
}

const taskSchema = z.object({
  title: nameField({ label: "Title", max: 500 }),
  description: z.string().optional(),
  priority: z.enum(["HIGH", "MEDIUM", "LOW"]).default("MEDIUM"),
  status: z.enum(["TODO", "IN_PROGRESS", "DONE", "CANCELLED"]).default("TODO"),
  dueDate: z.string().optional(),
  projectId: z.string().optional(),
  clientId: z.string().optional(),
  assigneeId: z.string().optional(),
});

export async function createTask(_prevState: unknown, formData: FormData) {
  // requireAuth (not raw auth()) so the role check below sees the
  // current DB role, not the sign-in-time JWT snapshot.
  const user = await requireAuth();

  // GUEST role defaults grant canView on tasks but nothing else —
  // without this gate any authenticated session could create tasks,
  // assign them to anyone, and trigger assignment emails.
  const perms = await resolveModulePerms(user.id, user.role, "tasks");
  if (!perms.canCreate) {
    return { error: "You don't have permission to create tasks." };
  }

  const raw = {
    title: formData.get("title") as string,
    description: (formData.get("description") as string) || undefined,
    priority: (formData.get("priority") as string) || "MEDIUM",
    status: (formData.get("status") as string) || "TODO",
    dueDate: (formData.get("dueDate") as string) || undefined,
    projectId: (formData.get("projectId") as string) || undefined,
    clientId: (formData.get("clientId") as string) || undefined,
    assigneeId: (formData.get("assigneeId") as string) || undefined,
  };
  // Opt-in: also drop the task into the assignee's own Google Tasks
  // (where a due date surfaces on their Google Calendar).
  const pushToGoogle = formData.get("pushToGoogle") === "true";

  const parsed = taskSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      error: parsed.error.errors[0].message,
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const data = parsed.data;

  // When the task has a project, its client is DERIVED from the project —
  // a form-supplied clientId that disagrees is ignored. Task.clientId can
  // otherwise drift from task.project.clientId and file the task under
  // the wrong client's rollups (audit §3.2-2). Standalone tasks (no
  // project) may still target a client directly.
  let clientId = data.clientId || null;
  if (data.projectId) {
    const project = await db.project.findFirst({
      where: { id: data.projectId, deletedAt: null },
      select: { clientId: true },
    });
    if (!project) return { error: "Project not found" };
    clientId = project.clientId;
  }

  const task = await db.task.create({
    data: {
      title: data.title,
      description: data.description || null,
      priority: data.priority,
      status: data.status,
      dueDate: data.dueDate ? new Date(data.dueDate) : null,
      projectId: data.projectId || null,
      clientId,
      assigneeId: data.assigneeId || null,
      createdById: user.id,
    },
  });

  await db.activityLog.create({
    data: {
      action: "created",
      entityType: "task",
      entityId: task.id,
      details: data.title,
      userId: user.id,
    },
  });

  revalidateTask({
    projectId: task.projectId,
    clientId: task.clientId,
    assigneeId: task.assigneeId,
  });

  if (task.assigneeId) {
    await notifyTaskAssigned({
      taskId: task.id,
      assigneeId: task.assigneeId,
      actorId: user.id,
      title: task.title,
      projectId: task.projectId,
    });
  }

  // Opt-in: mirror the task into the assignee's Google Tasks so it (and
  // its due date, on their Calendar) reaches their phone. Non-fatal —
  // task creation never fails because of Google, and it silently no-ops
  // when the assignee hasn't connected their own Google Tasks.
  if (pushToGoogle && task.assigneeId) {
    try {
      const connected = await db.googleTasksIntegration.findUnique({
        where: { userId: task.assigneeId },
        select: { id: true },
      });
      if (connected) {
        await pushNewTaskToGoogle(task.assigneeId, task.id);
      }
    } catch (err) {
      log.error("tasks.pushGoogle", "Push to assignee Google Tasks failed", err, { taskId: task.id });
    }
  }

  return { success: true };
}

const TASK_STATUSES = ["TODO", "IN_PROGRESS", "DONE", "CANCELLED"] as const;
type TaskStatus = (typeof TASK_STATUSES)[number];

export async function updateTaskStatus(taskId: string, status: string) {
  const user = await requireAuth();

  // Validate against the closed enum before the cast — an arbitrary
  // string here used to reach Prisma and throw a raw 500.
  if (!TASK_STATUSES.includes(status as TaskStatus)) {
    return { error: `Invalid status "${status}"` };
  }

  const denied = await authorizeTaskMutation(
    { id: user.id, role: user.role },
    taskId
  );
  if (denied) return denied;

  const completedAt = status === "DONE" ? new Date() : null;

  const task = await db.task.update({
    where: { id: taskId },
    data: {
      status: status as TaskStatus,
      completedAt,
    },
  });

  revalidateTask({
    projectId: task.projectId,
    clientId: task.clientId,
    assigneeId: task.assigneeId,
  });
  return { success: true };
}

/**
 * Move a task under a project (or clear it) without the full edit form.
 * Used by the /my Google-inbox triage and the project-page add-task flow.
 * The task's client is DERIVED from the project — never set independently
 * — so the client rollups can't disagree with the project's client.
 */
export async function assignTaskProject(taskId: string, projectId: string | null) {
  const user = await requireAuth();

  const denied = await authorizeTaskMutation({ id: user.id, role: user.role }, taskId);
  if (denied) return denied;

  let clientId: string | null = null;
  if (projectId) {
    const project = await db.project.findFirst({
      where: { id: projectId, deletedAt: null },
      select: { id: true, clientId: true },
    });
    if (!project) return { error: "Project not found" };
    clientId = project.clientId;
  }

  const previous = await db.task.findUnique({
    where: { id: taskId },
    select: { projectId: true, clientId: true, assigneeId: true },
  });

  const updated = await db.task.update({
    where: { id: taskId },
    data: { projectId: projectId || null, clientId },
  });

  revalidateTask({
    projectId: updated.projectId,
    clientId: updated.clientId,
    assigneeId: updated.assigneeId,
  });
  if (previous?.projectId && previous.projectId !== updated.projectId) {
    revalidateTask({ projectId: previous.projectId });
  }
  if (previous?.clientId && previous.clientId !== updated.clientId) {
    revalidateTask({ clientId: previous.clientId });
  }
  return { success: true };
}

export async function updateTask(_prevState: unknown, formData: FormData) {
  const user = await requireAuth();

  const taskId = formData.get("taskId") as string;
  const denied = await authorizeTaskMutation(
    { id: user.id, role: user.role },
    taskId
  );
  if (denied) return denied;
  const raw = {
    title: formData.get("title") as string,
    description: (formData.get("description") as string) || undefined,
    priority: (formData.get("priority") as string) || "MEDIUM",
    status: (formData.get("status") as string) || "TODO",
    dueDate: (formData.get("dueDate") as string) || undefined,
    projectId: (formData.get("projectId") as string) || undefined,
    clientId: (formData.get("clientId") as string) || undefined,
    assigneeId: (formData.get("assigneeId") as string) || undefined,
  };

  const parsed = taskSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      error: parsed.error.errors[0].message,
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const data = parsed.data;
  const completedAt = data.status === "DONE" ? new Date() : null;

  // Same client-derivation rule as createTask: a project-linked task's
  // client always follows the project.
  let clientId = data.clientId || null;
  if (data.projectId) {
    const project = await db.project.findFirst({
      where: { id: data.projectId, deletedAt: null },
      select: { clientId: true },
    });
    if (!project) return { error: "Project not found" };
    clientId = project.clientId;
  }

  // Look up the previous state so we can revalidate pages the task is moving
  // away from (old project, old client, old assignee).
  const previous = await db.task.findUnique({
    where: { id: taskId },
    select: { projectId: true, clientId: true, assigneeId: true },
  });

  const updated = await db.task.update({
    where: { id: taskId },
    data: {
      title: data.title,
      description: data.description || null,
      priority: data.priority,
      status: data.status,
      completedAt,
      dueDate: data.dueDate ? new Date(data.dueDate) : null,
      projectId: data.projectId || null,
      clientId,
      assigneeId: data.assigneeId || null,
    },
  });

  // Revalidate the new location
  revalidateTask({
    projectId: updated.projectId,
    clientId: updated.clientId,
    assigneeId: updated.assigneeId,
    previousAssigneeId: previous?.assigneeId,
  });
  // If project/client changed, also revalidate the previous project/client pages
  // so the task disappears from them.
  if (previous?.projectId && previous.projectId !== updated.projectId) {
    revalidateTask({ projectId: previous.projectId });
  }
  if (previous?.clientId && previous.clientId !== updated.clientId) {
    revalidateTask({ clientId: previous.clientId });
  }

  // Notify the new assignee if the assignment changed (or someone was just
  // added). Don't fire if it's the same person — that's a no-op edit.
  if (updated.assigneeId && updated.assigneeId !== previous?.assigneeId) {
    await notifyTaskAssigned({
      taskId: updated.id,
      assigneeId: updated.assigneeId,
      actorId: user.id,
      title: updated.title,
      projectId: updated.projectId,
    });
  }

  return { success: true };
}

export async function deleteTask(taskId: string) {
  const user = await requireAuth();

  const denied = await authorizeTaskMutation(
    { id: user.id, role: user.role },
    taskId
  );
  if (denied) return denied;

  // Look up before soft-delete so we can revalidate the right pages
  // and detect "already in trash" before stamping deletedAt again.
  const task = await db.task.findUnique({
    where: { id: taskId },
    select: { projectId: true, clientId: true, assigneeId: true, title: true, deletedAt: true },
  });
  if (!task) return { error: "Task not found" };
  if (task.deletedAt) {
    return { error: "Already in the recovery bin" };
  }

  await db.task.update({ where: { id: taskId }, data: { deletedAt: new Date() } });
  await db.activityLog.create({
    data: {
      action: "soft-deleted",
      entityType: "task",
      entityId: taskId,
      details: task.title,
      userId: user.id,
      projectId: task.projectId,
      clientId: task.clientId,
    },
  });

  revalidateTask({
    projectId: task.projectId,
    clientId: task.clientId,
    assigneeId: task.assigneeId,
  });
  return { success: true };
}
