"use server";

import { db } from "@/lib/db";
import { requireAuth, resolveModulePerms } from "@/lib/permissions";
import { revalidatePath } from "next/cache";
import { z } from "zod";

const entityModuleMap: Record<string, string> = {
  project: "projects",
  contract: "contracts",
  supplier: "suppliers",
  intranet: "intranet",
  tool: "tools",
  document: "projects",
  subcontractor: "subcontractors",
  partnership: "partnerships",
};

function getFkField(entityType: string): string {
  if (entityType === "intranet") return "intranetResourceId";
  return `${entityType}Id`;
}

const linkSchema = z.object({
  entityType: z.string(),
  entityId: z.string(),
  title: z.string().min(1),
  url: z.string().url(),
  description: z.string().optional(),
  source: z.string().optional(),
});

export async function addExternalLink(_prev: unknown, formData: FormData) {
  const user = await requireAuth();
  const parsed = linkSchema.safeParse({
    entityType: formData.get("entityType"),
    entityId: formData.get("entityId"),
    title: formData.get("title"),
    url: formData.get("url"),
    description: formData.get("description") || undefined,
    source: formData.get("source") || "manual",
  });

  if (!parsed.success) return { error: "Invalid input" };

  const { entityType, entityId, ...data } = parsed.data;
  const moduleName = entityModuleMap[entityType];
  if (moduleName) {
    const perms = await resolveModulePerms(user.id, user.role, moduleName);
    if (!perms.canEdit) return { error: "Permission denied" };
  }

  await db.externalLink.create({
    data: {
      ...data,
      source: data.source || "manual",
      [getFkField(entityType)]: entityId,
    },
  });

  revalidatePath("/");
  return { success: true };
}

export async function deleteExternalLink(_prev: unknown, formData: FormData) {
  const user = await requireAuth();
  const id = formData.get("id") as string;

  const link = await db.externalLink.findUnique({ where: { id } });
  if (!link) return { error: "Not found" };

  const entityType = link.projectId
    ? "project"
    : link.contractId
      ? "contract"
      : link.supplierId
        ? "supplier"
        : link.subcontractorId
          ? "subcontractor"
          : link.partnershipId
            ? "partnership"
            : "intranet";
  const moduleName = entityModuleMap[entityType];
  const perms = await resolveModulePerms(user.id, user.role, moduleName);
  if (!perms.canDelete) return { error: "Permission denied" };

  await db.externalLink.delete({ where: { id } });
  revalidatePath("/");
  return { success: true };
}

const embedSchema = z.object({
  entityType: z.string(),
  entityId: z.string(),
  title: z.string().min(1),
  embedUrl: z.string().min(1),
  embedType: z.string().optional(),
  description: z.string().optional(),
  width: z.string().optional(),
  height: z.string().optional(),
});

export async function addEmbed(_prev: unknown, formData: FormData) {
  const user = await requireAuth();
  const parsed = embedSchema.safeParse({
    entityType: formData.get("entityType"),
    entityId: formData.get("entityId"),
    title: formData.get("title"),
    embedUrl: formData.get("embedUrl"),
    embedType: formData.get("embedType") || "iframe",
    description: formData.get("description") || undefined,
    width: formData.get("width") || "100%",
    height: formData.get("height") || "600px",
  });

  if (!parsed.success) return { error: "Invalid input" };

  const { entityType, entityId, ...data } = parsed.data;
  const moduleName = entityModuleMap[entityType];
  if (moduleName) {
    const perms = await resolveModulePerms(user.id, user.role, moduleName);
    if (!perms.canEdit) return { error: "Permission denied" };
  }

  await db.embed.create({
    data: {
      ...data,
      embedType: (data.embedType as "iframe" | "google_form" | "jotform" | "other") || "iframe",
      [getFkField(entityType)]: entityId,
    },
  });

  revalidatePath("/");
  return { success: true };
}

export async function deleteEmbed(_prev: unknown, formData: FormData) {
  const user = await requireAuth();
  const id = formData.get("id") as string;

  const embed = await db.embed.findUnique({ where: { id } });
  if (!embed) return { error: "Not found" };

  const entityType = embed.projectId ? "project" : embed.contractId ? "contract" : embed.toolId ? "tool" : "intranet";
  const moduleName = entityModuleMap[entityType];
  const perms = await resolveModulePerms(user.id, user.role, moduleName);
  if (!perms.canDelete) return { error: "Permission denied" };

  await db.embed.delete({ where: { id } });
  revalidatePath("/");
  return { success: true };
}
