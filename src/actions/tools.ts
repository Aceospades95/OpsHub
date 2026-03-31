"use server";

import { db } from "@/lib/db";
import { requireAuth, resolveModulePerms } from "@/lib/permissions";
import { logActivity } from "@/lib/activity";
import { revalidatePath } from "next/cache";
import { z } from "zod";

const toolSchema = z.object({
  name: z.string().min(1, "Name is required"),
  description: z.string().optional(),
  category: z.string().optional(),
  toolUrl: z.string().optional(),
  toolType: z.string().optional(),
  isGlobal: z.boolean().optional(),
});

export async function createTool(_prev: unknown, formData: FormData) {
  const user = await requireAuth();
  const perms = await resolveModulePerms(user.id, user.role, "tools");
  if (!perms.canCreate) return { error: "Permission denied" };

  const parsed = toolSchema.safeParse({
    name: formData.get("name"),
    description: formData.get("description") || undefined,
    category: formData.get("category") || undefined,
    toolUrl: formData.get("toolUrl") || undefined,
    toolType: formData.get("toolType") || "internal",
    isGlobal: formData.get("isGlobal") !== "false",
  });

  if (!parsed.success) return { error: "Invalid input", fieldErrors: parsed.error.flatten().fieldErrors };

  const tool = await db.tool.create({ data: parsed.data });
  await logActivity("created", "tool", tool.id, user.id, tool.name);
  revalidatePath("/tools");
  return { success: true };
}

export async function updateTool(_prev: unknown, formData: FormData) {
  const user = await requireAuth();
  const perms = await resolveModulePerms(user.id, user.role, "tools");
  if (!perms.canEdit) return { error: "Permission denied" };

  const id = formData.get("id") as string;
  const parsed = toolSchema.safeParse({
    name: formData.get("name"),
    description: formData.get("description") || undefined,
    category: formData.get("category") || undefined,
    toolUrl: formData.get("toolUrl") || undefined,
    toolType: formData.get("toolType") || "internal",
    isGlobal: formData.get("isGlobal") !== "false",
  });

  if (!parsed.success) return { error: "Invalid input", fieldErrors: parsed.error.flatten().fieldErrors };

  await db.tool.update({ where: { id }, data: parsed.data });
  await logActivity("updated", "tool", id, user.id, parsed.data.name);
  revalidatePath(`/tools/${id}`);
  revalidatePath("/tools");
  return { success: true };
}

export async function deleteTool(_prev: unknown, formData: FormData) {
  const user = await requireAuth();
  const perms = await resolveModulePerms(user.id, user.role, "tools");
  if (!perms.canDelete) return { error: "Permission denied" };

  const id = formData.get("id") as string;
  const tool = await db.tool.findUnique({ where: { id } });
  if (!tool) return { error: "Not found" };

  await db.tool.delete({ where: { id } });
  await logActivity("deleted", "tool", id, user.id, tool.name);
  revalidatePath("/tools");
  return { success: true };
}

export async function cloneTool(_prev: unknown, formData: FormData) {
  const user = await requireAuth();
  const perms = await resolveModulePerms(user.id, user.role, "tools");
  if (!perms.canCreate) return { error: "Permission denied" };

  const id = formData.get("id") as string;
  const original = await db.tool.findUnique({
    where: { id },
    include: { embeds: true },
  });

  if (!original) return { error: "Tool not found" };

  const clone = await db.tool.create({
    data: {
      name: `${original.name} (Copy)`,
      description: original.description,
      category: original.category,
      toolUrl: original.toolUrl,
      toolType: original.toolType,
      isGlobal: original.isGlobal,
      clonedFromId: original.id,
    },
  });

  // Clone embeds
  for (const embed of original.embeds) {
    await db.embed.create({
      data: {
        title: embed.title,
        embedUrl: embed.embedUrl,
        embedType: embed.embedType,
        description: embed.description,
        width: embed.width,
        height: embed.height,
        toolId: clone.id,
      },
    });
  }

  await logActivity("created", "tool", clone.id, user.id, `Cloned from ${original.name}`);
  revalidatePath("/tools");
  return { success: true };
}

export async function assignToolToProject(_prev: unknown, formData: FormData) {
  const user = await requireAuth();
  const perms = await resolveModulePerms(user.id, user.role, "tools");
  if (!perms.canEdit) return { error: "Permission denied" };

  const toolId = formData.get("toolId") as string;
  const projectId = formData.get("projectId") as string;

  const existing = await db.projectTool.findUnique({
    where: { projectId_toolId: { projectId, toolId } },
  });
  if (existing) return { error: "Already assigned" };

  await db.projectTool.create({ data: { projectId, toolId } });
  revalidatePath(`/tools/${toolId}`);
  return { success: true };
}

export async function removeToolFromProject(_prev: unknown, formData: FormData) {
  const user = await requireAuth();
  const perms = await resolveModulePerms(user.id, user.role, "tools");
  if (!perms.canEdit) return { error: "Permission denied" };

  const id = formData.get("id") as string;
  await db.projectTool.delete({ where: { id } });
  revalidatePath("/tools");
  return { success: true };
}
