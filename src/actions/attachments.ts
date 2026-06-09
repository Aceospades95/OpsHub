"use server";

import { db } from "@/lib/db";
import { requireAuth, resolveModulePerms } from "@/lib/permissions";
import { assertManageEntity } from "@/lib/entity-authz";
import type { ScopeEntityType } from "@/lib/scope";
import { revalidatePath } from "next/cache";
import type { Role } from "@prisma/client";
import { z } from "zod";

/**
 * Closed sets of host entity types per attachment model — these MUST
 * match the FK columns on ExternalLink / Embed in the Prisma schema.
 * The entityType used to be an open z.string(): any value outside the
 * module map silently skipped the permission check entirely while
 * `[getFkField(entityType)]` injected an attacker-chosen field name
 * into the Prisma create.
 */
const LINK_ENTITY_TYPES = [
  "project",
  "contract",
  "supplier",
  "intranet",
  "subcontractor",
  "partnership",
  "certification",
] as const;

const EMBED_ENTITY_TYPES = [
  "project",
  "contract",
  "document",
  "tool",
  "intranet",
  "certification",
] as const;

type AttachmentEntityType =
  | (typeof LINK_ENTITY_TYPES)[number]
  | (typeof EMBED_ENTITY_TYPES)[number];

const entityModuleMap: Record<AttachmentEntityType, string> = {
  project: "projects",
  contract: "contracts",
  supplier: "suppliers",
  intranet: "intranet",
  tool: "tools",
  document: "projects",
  subcontractor: "subcontractors",
  partnership: "partnerships",
  certification: "certifications",
};

/** Entity types whose writes are additionally bounded by the actor's
 * per-entity scope (see lib/entity-authz.ts). */
const SCOPED_ENTITY_TYPES: Partial<Record<AttachmentEntityType, ScopeEntityType>> = {
  project: "project",
  contract: "contract",
  tool: "tool",
  certification: "certification",
};

function getFkField(entityType: AttachmentEntityType): string {
  if (entityType === "intranet") return "intranetResourceId";
  return `${entityType}Id`;
}

/**
 * Verify the host entity exists and isn't soft-deleted, and that the
 * actor passes the module + entity-scope write gates for it. Returns
 * { error } or null. Every host model here carries a deletedAt column.
 */
async function authorizeAttachmentWrite(
  user: { id: string; role: Role },
  entityType: AttachmentEntityType,
  entityId: string,
  flag: "canEdit" | "canDelete"
): Promise<{ error: string } | null> {
  const moduleName = entityModuleMap[entityType];
  const perms = await resolveModulePerms(user.id, user.role, moduleName);
  if (!perms[flag]) return { error: "Permission denied" };

  const host = await findHost(entityType, entityId);
  if (!host) return { error: "Not found" };

  // Documents inherit their parent project's scope.
  const scopeType =
    entityType === "document" && host.projectId
      ? ("project" as const)
      : SCOPED_ENTITY_TYPES[entityType];
  const scopeId =
    entityType === "document" && host.projectId ? host.projectId : entityId;
  if (scopeType) {
    const denied = await assertManageEntity(user.id, user.role, scopeType, scopeId);
    if (denied) return denied;
  }
  return null;
}

type HostRow = { id: string; projectId?: string | null } | null;

function findHost(
  entityType: AttachmentEntityType,
  entityId: string
): Promise<HostRow> {
  const where = { id: entityId, deletedAt: null };
  switch (entityType) {
    case "project":
      return db.project.findFirst({ where, select: { id: true } });
    case "contract":
      return db.contract.findFirst({ where, select: { id: true } });
    case "supplier":
      return db.supplier.findFirst({ where, select: { id: true } });
    case "intranet":
      return db.intranetResource.findFirst({ where, select: { id: true } });
    case "tool":
      return db.tool.findFirst({ where, select: { id: true } });
    case "document":
      return db.document.findFirst({
        where,
        select: { id: true, projectId: true },
      });
    case "subcontractor":
      return db.subcontractor.findFirst({ where, select: { id: true } });
    case "partnership":
      return db.partnership.findFirst({ where, select: { id: true } });
    case "certification":
      return db.certification.findFirst({ where, select: { id: true } });
  }
}

/**
 * Revalidate the host entity's detail page (plus the project page for
 * documents). The old revalidatePath("/") only refreshed the root —
 * the page actually showing the attachment kept its stale cache.
 */
async function revalidateHost(
  entityType: AttachmentEntityType,
  entityId: string
) {
  switch (entityType) {
    case "project":
      revalidatePath(`/projects/${entityId}`);
      break;
    case "contract":
      revalidatePath(`/contracts/${entityId}`);
      break;
    case "supplier":
      revalidatePath(`/suppliers/${entityId}`);
      break;
    case "intranet":
      revalidatePath(`/intranet/${entityId}`);
      break;
    case "tool":
      revalidatePath(`/tools/${entityId}`);
      break;
    case "subcontractor":
      revalidatePath(`/subcontractors/${entityId}`);
      break;
    case "partnership":
      revalidatePath(`/partnerships/${entityId}`);
      break;
    case "certification":
      revalidatePath(`/certifications/${entityId}`);
      break;
    case "document": {
      const doc = await db.document.findUnique({
        where: { id: entityId },
        select: { projectId: true },
      });
      if (doc?.projectId) {
        revalidatePath(`/projects/${doc.projectId}/documents/${entityId}`);
        revalidatePath(`/projects/${doc.projectId}`);
      }
      break;
    }
  }
}

/**
 * Loose result shape shared by the actions below — consumers probe
 * result.success / result.error without narrowing, so every branch
 * must carry both keys as optionals.
 */
type AttachmentActionResult = { success?: true; error?: string };

const linkSchema = z.object({
  entityType: z.enum(LINK_ENTITY_TYPES),
  entityId: z.string().min(1),
  title: z.string().min(1).max(300),
  url: z.string().url().max(2000),
  description: z.string().max(2000).optional(),
  source: z.string().max(100).optional(),
});

export async function addExternalLink(
  _prev: unknown,
  formData: FormData
): Promise<AttachmentActionResult> {
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
  const denied = await authorizeAttachmentWrite(user, entityType, entityId, "canEdit");
  if (denied) return denied;

  await db.externalLink.create({
    data: {
      ...data,
      source: data.source || "manual",
      [getFkField(entityType)]: entityId,
    },
  });

  await revalidateHost(entityType, entityId);
  return { success: true };
}

export async function deleteExternalLink(
  _prev: unknown,
  formData: FormData
): Promise<AttachmentActionResult> {
  const user = await requireAuth();
  const id = formData.get("id") as string;

  const link = await db.externalLink.findUnique({ where: { id } });
  if (!link) return { error: "Not found" };

  // Exhaustive over ExternalLink's FK columns — a row whose only FK is
  // certificationId used to fall through to the intranet module check.
  const [entityType, entityId] = link.projectId
    ? (["project", link.projectId] as const)
    : link.contractId
      ? (["contract", link.contractId] as const)
      : link.supplierId
        ? (["supplier", link.supplierId] as const)
        : link.subcontractorId
          ? (["subcontractor", link.subcontractorId] as const)
          : link.partnershipId
            ? (["partnership", link.partnershipId] as const)
            : link.certificationId
              ? (["certification", link.certificationId] as const)
              : (["intranet", link.intranetResourceId ?? ""] as const);
  const denied = await authorizeAttachmentWrite(user, entityType, entityId, "canDelete");
  if (denied) return denied;

  await db.externalLink.delete({ where: { id } });
  await revalidateHost(entityType, entityId);
  return { success: true };
}

const embedSchema = z.object({
  entityType: z.enum(EMBED_ENTITY_TYPES),
  entityId: z.string().min(1),
  title: z.string().min(1).max(300),
  // http(s) only — an embed URL lands in an iframe src, so a javascript:
  // or data: URL here would be stored XSS for everyone viewing the page.
  embedUrl: z
    .string()
    .url()
    .max(2000)
    .refine((u) => /^https?:\/\//i.test(u), "Embed URL must be http(s)"),
  embedType: z.enum(["iframe", "google_form", "jotform", "other"]).optional(),
  description: z.string().max(2000).optional(),
  width: z.string().max(20).optional(),
  height: z.string().max(20).optional(),
});

export async function addEmbed(
  _prev: unknown,
  formData: FormData
): Promise<AttachmentActionResult> {
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
  const denied = await authorizeAttachmentWrite(user, entityType, entityId, "canEdit");
  if (denied) return denied;

  await db.embed.create({
    data: {
      ...data,
      embedType: data.embedType || "iframe",
      [getFkField(entityType)]: entityId,
    },
  });

  await revalidateHost(entityType, entityId);
  return { success: true };
}

export async function deleteEmbed(
  _prev: unknown,
  formData: FormData
): Promise<AttachmentActionResult> {
  const user = await requireAuth();
  const id = formData.get("id") as string;

  const embed = await db.embed.findUnique({ where: { id } });
  if (!embed) return { error: "Not found" };

  // Exhaustive over Embed's FK columns (document + certification were
  // previously missing and mis-gated as intranet).
  const [entityType, entityId] = embed.projectId
    ? (["project", embed.projectId] as const)
    : embed.contractId
      ? (["contract", embed.contractId] as const)
      : embed.documentId
        ? (["document", embed.documentId] as const)
        : embed.toolId
          ? (["tool", embed.toolId] as const)
          : embed.certificationId
            ? (["certification", embed.certificationId] as const)
            : (["intranet", embed.intranetResourceId ?? ""] as const);
  const denied = await authorizeAttachmentWrite(user, entityType, entityId, "canDelete");
  if (denied) return denied;

  await db.embed.delete({ where: { id } });
  await revalidateHost(entityType, entityId);
  return { success: true };
}
