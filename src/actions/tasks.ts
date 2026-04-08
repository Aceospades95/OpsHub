"use server";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { revalidatePath } from "next/cache";
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

  await db.task.create({
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
      entityId: "new",
      details: data.title,
      userId: session.user.id,
    },
  });

  revalidatePath("/dashboard");
  revalidatePath("/tasks");
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

  revalidatePath("/dashboard");
  revalidatePath("/tasks");
  if (task.projectId) {
    revalidatePath(`/projects/${task.projectId}`);
  }
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

  await db.task.update({
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

  revalidatePath("/dashboard");
  revalidatePath("/tasks");
  return { success: true };
}

export async function deleteTask(taskId: string) {
  const session = await auth();
  if (!session?.user) return { error: "Unauthorized" };

  await db.task.delete({ where: { id: taskId } });

  revalidatePath("/dashboard");
  revalidatePath("/tasks");
  return { success: true };
}
