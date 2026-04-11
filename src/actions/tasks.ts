"use server";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { revalidateTask } from "@/lib/revalidate-entity";
import { z } from "zod";

const taskSchema = z.object({
  title: z.string().min(1, "Title is required"),
  description: z.string().optional(),
  priority: z.enum(["HIGH", "MEDIUM", "LOW"]).default("MEDIUM"),
  status: z.enum(["TODO", "IN_PROGRESS", "DONE", "CANCELLED"]).default("TODO"),
  dueDate: z.string().optional(),
  projectId: z.string().optional(),
  clientId: z.string().optional(),
  assigneeId: z.string().optional(),
});

export async function createTask(_prevState: unknown, formData: FormData) {
  const session = await auth();
  if (!session?.user) return { error: "Unauthorized" };

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
    return { error: parsed.error.errors[0].message };
  }

  const data = parsed.data;

  const task = await db.task.create({
    data: {
      title: data.title,
      description: data.description || null,
      priority: data.priority,
      status: data.status,
      dueDate: data.dueDate ? new Date(data.dueDate) : null,
      projectId: data.projectId || null,
      clientId: data.clientId || null,
      assigneeId: data.assigneeId || null,
      createdById: session.user.id,
    },
  });

  await db.activityLog.create({
    data: {
      action: "created",
      entityType: "task",
      entityId: task.id,
      details: data.title,
      userId: session.user.id,
    },
  });

  revalidateTask({
    projectId: task.projectId,
    clientId: task.clientId,
    assigneeId: task.assigneeId,
  });
  return { success: true };
}

export async function updateTaskStatus(taskId: string, status: string) {
  const session = await auth();
  if (!session?.user) return { error: "Unauthorized" };

  const completedAt = status === "DONE" ? new Date() : null;

  const task = await db.task.update({
    where: { id: taskId },
    data: {
      status: status as "TODO" | "IN_PROGRESS" | "DONE" | "CANCELLED",
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

export async function updateTask(_prevState: unknown, formData: FormData) {
  const session = await auth();
  if (!session?.user) return { error: "Unauthorized" };

  const taskId = formData.get("taskId") as string;
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
    return { error: parsed.error.errors[0].message };
  }

  const data = parsed.data;
  const completedAt = data.status === "DONE" ? new Date() : null;

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
      clientId: data.clientId || null,
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
  return { success: true };
}

export async function deleteTask(taskId: string) {
  const session = await auth();
  if (!session?.user) return { error: "Unauthorized" };

  // Look up before delete so we can revalidate the right pages
  const task = await db.task.findUnique({
    where: { id: taskId },
    select: { projectId: true, clientId: true, assigneeId: true },
  });
  await db.task.delete({ where: { id: taskId } });

  revalidateTask({
    projectId: task?.projectId,
    clientId: task?.clientId,
    assigneeId: task?.assigneeId,
  });
  return { success: true };
}
