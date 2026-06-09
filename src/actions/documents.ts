"use server";

import { db } from "@/lib/db";
import { requireAuth, resolveModulePerms } from "@/lib/permissions";
import { assertManageEntity } from "@/lib/entity-authz";
import { logActivity } from "@/lib/activity";
import { deriveActivityScope } from "@/lib/activity-scope";
import { revalidatePath } from "next/cache";
import type { Role } from "@prisma/client";
import { z } from "zod";

/**
 * Documents inherit their parent project's write scope: a CONTRIBUTOR
 * with module-level canEdit may still only touch documents on projects
 * in their assigned set (lib/entity-authz.ts).
 */
async function gateDocumentProject(
  user: { id: string; role: Role },
  projectId: string | null | undefined
): Promise<{ error: string } | null> {
  if (!projectId) return null;
  return assertManageEntity(user.id, user.role, "project", projectId);
}

const documentSchema = z.object({
  title: z.string().min(1, "Title is required"),
  content: z.string().optional(),
  type: z.enum(["SOP", "GUIDE", "POLICY", "REFERENCE", "TEMPLATE", "OTHER"]).optional(),
  published: z.boolean().optional(),
  projectId: z.string().optional(),
});

export async function createDocument(_prev: unknown, formData: FormData) {
  const user = await requireAuth();
  const perms = await resolveModulePerms(user.id, user.role, "projects");
  if (!perms.canCreate) return { error: "Permission denied" };

  const parsed = documentSchema.safeParse({
    title: formData.get("title"),
    content: formData.get("content") || undefined,
    type: formData.get("type") || "OTHER",
    published: formData.get("published") === "true",
    projectId: formData.get("projectId") || undefined,
  });

  if (!parsed.success) return { error: "Invalid input", fieldErrors: parsed.error.flatten().fieldErrors };

  if (parsed.data.projectId) {
    const project = await db.project.findFirst({
      where: { id: parsed.data.projectId, deletedAt: null },
      select: { id: true },
    });
    if (!project) return { error: "Project not found" };
  }
  const scopeGate = await gateDocumentProject(user, parsed.data.projectId);
  if (scopeGate) return scopeGate;

  const doc = await db.document.create({ data: parsed.data });
  await logActivity("created", "document", doc.id, user.id, doc.title, await deriveActivityScope("document", doc.id));
  if (parsed.data.projectId) revalidatePath(`/projects/${parsed.data.projectId}`);
  return { success: true, documentId: doc.id };
}

export async function updateDocument(_prev: unknown, formData: FormData) {
  const user = await requireAuth();
  const perms = await resolveModulePerms(user.id, user.role, "projects");
  if (!perms.canEdit) return { error: "Permission denied" };

  const id = formData.get("id") as string;
  const changelog = (formData.get("changelog") as string) || undefined;

  const existing = await db.document.findFirst({ where: { id, deletedAt: null } });
  if (!existing) return { error: "Not found" };
  const scopeGate = await gateDocumentProject(user, existing.projectId);
  if (scopeGate) return scopeGate;

  const parsed = documentSchema.safeParse({
    title: formData.get("title"),
    content: formData.get("content") || undefined,
    type: formData.get("type") || existing.type,
    published: formData.get("published") === "true",
    projectId: formData.get("projectId") || existing.projectId || undefined,
  });

  if (!parsed.success) return { error: "Invalid input", fieldErrors: parsed.error.flatten().fieldErrors };

  // If content changed, save the previous version atomically with the
  // update — concurrent edits could otherwise duplicate version rows or
  // lose the increment.
  const contentChanged = existing.content !== (parsed.data.content || null);
  await db.$transaction(async (tx) => {
    if (contentChanged && existing.content) {
      await tx.documentVersion.create({
        data: {
          version: existing.version,
          content: existing.content,
          changelog,
          documentId: id,
        },
      });
    }
    await tx.document.update({
      where: { id },
      data: {
        ...parsed.data,
        version: contentChanged ? existing.version + 1 : existing.version,
      },
    });
  });

  await logActivity("updated", "document", id, user.id, parsed.data.title, await deriveActivityScope("document", id));
  revalidatePath(`/projects/${existing.projectId}/documents/${id}`);
  // The parent project page lists this document's title — revalidate it too.
  revalidatePath(`/projects/${existing.projectId}`);
  return { success: true };
}

export async function deleteDocument(_prev: unknown, formData: FormData) {
  const user = await requireAuth();
  const perms = await resolveModulePerms(user.id, user.role, "projects");
  if (!perms.canDelete) return { error: "Permission denied" };

  const id = formData.get("id") as string;
  const doc = await db.document.findUnique({ where: { id } });
  if (!doc) return { error: "Not found" };
  if (doc.deletedAt) {
    return { error: "Already in the recovery bin" };
  }
  const scopeGate = await gateDocumentProject(user, doc.projectId);
  if (scopeGate) return scopeGate;

  // Snapshot the project scope so the activity-log entry carries it
  // even after the cron eventually purges the document row.
  const scope = doc.projectId
    ? {
        projectId: doc.projectId,
        clientId:
          (await db.project.findUnique({
            where: { id: doc.projectId },
            select: { clientId: true },
          }))?.clientId ?? null,
      }
    : {};
  await db.document.update({ where: { id }, data: { deletedAt: new Date() } });
  await logActivity("soft-deleted", "document", id, user.id, doc.title, scope);
  if (doc.projectId) revalidatePath(`/projects/${doc.projectId}`);
  return { success: true };
}

export async function restoreDocumentVersion(_prev: unknown, formData: FormData) {
  const user = await requireAuth();
  const perms = await resolveModulePerms(user.id, user.role, "projects");
  if (!perms.canEdit) return { error: "Permission denied" };

  const documentId = formData.get("documentId") as string;
  const versionId = formData.get("versionId") as string;

  const doc = await db.document.findFirst({ where: { id: documentId, deletedAt: null } });
  if (!doc) return { error: "Document not found" };
  const scopeGate = await gateDocumentProject(user, doc.projectId);
  if (scopeGate) return scopeGate;

  const version = await db.documentVersion.findUnique({ where: { id: versionId } });
  // The version must belong to THIS document — a versionId from another
  // document would otherwise exfiltrate that document's content into
  // one the caller can view (or corrupt this one with foreign content).
  if (!version || version.documentId !== documentId) {
    return { error: "Version not found" };
  }

  await db.$transaction(async (tx) => {
    // Save current content as a version before restoring
    if (doc.content) {
      await tx.documentVersion.create({
        data: {
          version: doc.version,
          content: doc.content,
          changelog: `Before restoring to v${version.version}`,
          documentId,
        },
      });
    }
    await tx.document.update({
      where: { id: documentId },
      data: {
        content: version.content,
        version: doc.version + 1,
      },
    });
  });

  await logActivity("updated", "document", documentId, user.id, `Restored to v${version.version}`, await deriveActivityScope("document", documentId));
  revalidatePath(`/projects/${doc.projectId}/documents/${documentId}`);
  revalidatePath(`/projects/${doc.projectId}`);
  return { success: true };
}
