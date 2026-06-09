"use server";

import { db } from "@/lib/db";
import { requireAuth, resolveModulePerms } from "@/lib/permissions";
import { assertManageEntity } from "@/lib/entity-authz";
import { logActivity } from "@/lib/activity";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { nameField } from "@/lib/validation";

const toolSchema = z.object({
  name: nameField({ label: "Name" }),
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

  // Existence + soft-delete guard: a missing id would throw P2025 (→ 500)
  // and a soft-deleted tool must not be editable from a stale form.
  const existing = await db.tool.findFirst({
    where: { id, deletedAt: null },
    select: { id: true },
  });
  if (!existing) return { error: "Not found" };

  // Entity-scope write gate — module canEdit alone would let any
  // CONTRIBUTOR mutate arbitrary tools by id.
  const denied = await assertManageEntity(user.id, user.role, "tool", id);
  if (denied) return { error: denied.error };

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
  if (tool.deletedAt) {
    return { error: "Already in the recovery bin" };
  }

  const denied = await assertManageEntity(user.id, user.role, "tool", id);
  if (denied) return { error: denied.error };

  await db.tool.update({ where: { id }, data: { deletedAt: new Date() } });
  await logActivity("soft-deleted", "tool", id, user.id, tool.name);
  revalidatePath("/tools");
  return { success: true };
}

export async function cloneTool(_prev: unknown, formData: FormData) {
  const user = await requireAuth();
  const perms = await resolveModulePerms(user.id, user.role, "tools");
  if (!perms.canCreate) return { error: "Permission denied" };

  const id = formData.get("id") as string;
  const original = await db.tool.findFirst({
    where: { id, deletedAt: null },
    include: { embeds: true },
  });

  if (!original) return { error: "Tool not found" };

  // Clone + embeds atomically — a failure partway through must not leave
  // a half-cloned tool with missing embeds.
  const clone = await db.$transaction(async (tx) => {
    const created = await tx.tool.create({
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
    if (original.embeds.length > 0) {
      await tx.embed.createMany({
        data: original.embeds.map((embed) => ({
          title: embed.title,
          embedUrl: embed.embedUrl,
          embedType: embed.embedType,
          description: embed.description,
          width: embed.width,
          height: embed.height,
          toolId: created.id,
        })),
      });
    }

    return created;
  });

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

  // Both ends of the link must exist (and not be soft-deleted).
  const [tool, project] = await Promise.all([
    db.tool.findFirst({ where: { id: toolId, deletedAt: null }, select: { id: true } }),
    db.project.findFirst({ where: { id: projectId, deletedAt: null }, select: { id: true } }),
  ]);
  if (!tool || !project) return { error: "Not found" };

  const denied = await assertManageEntity(user.id, user.role, "tool", toolId);
  if (denied) return { error: denied.error };

  const existing = await db.projectTool.findUnique({
    where: { projectId_toolId: { projectId, toolId } },
  });
  if (existing) return { error: "Already assigned" };

  await db.projectTool.create({ data: { projectId, toolId } });
  revalidatePath(`/tools/${toolId}`);
  revalidatePath(`/projects/${projectId}`);
  return { success: true };
}

export async function removeToolFromProject(_prev: unknown, formData: FormData) {
  const user = await requireAuth();
  const perms = await resolveModulePerms(user.id, user.role, "tools");
  if (!perms.canEdit) return { error: "Permission denied" };

  const id = formData.get("id") as string;
  // Look up the link first — a stale double-submit would otherwise throw
  // P2025 (→ 500), and we need the toolId/projectId for the gate and
  // revalidation anyway.
  const link = await db.projectTool.findUnique({
    where: { id },
    select: { toolId: true, projectId: true },
  });
  if (!link) return { error: "Not found" };

  const denied = await assertManageEntity(user.id, user.role, "tool", link.toolId);
  if (denied) return { error: denied.error };

  await db.projectTool.delete({ where: { id } });
  revalidatePath("/tools");
  revalidatePath(`/tools/${link.toolId}`);
  revalidatePath(`/projects/${link.projectId}`);
  return { success: true };
}
