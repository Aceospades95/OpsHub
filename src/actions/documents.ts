"use server";

import { db } from "@/lib/db";
import { requireAuth, resolveModulePerms } from "@/lib/permissions";
import { logActivity } from "@/lib/activity";
import { revalidatePath } from "next/cache";
import { z } from "zod";

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

  const doc = await db.document.create({ data: parsed.data });
  await logActivity("created", "document", doc.id, user.id, doc.title);
  revalidatePath(`/projects/${parsed.data.projectId}`);
  return { success: true, documentId: doc.id };
}

export async function updateDocument(_prev: unknown, formData: FormData) {
  const user = await requireAuth();
  const perms = await resolveModulePerms(user.id, user.role, "projects");
  if (!perms.canEdit) return { error: "Permission denied" };

  const id = formData.get("id") as string;
  const changelog = (formData.get("changelog") as string) || undefined;

  const existing = await db.document.findUnique({ where: { id } });
  if (!existing) return { error: "Not found" };

  const parsed = documentSchema.safeParse({
    title: formData.get("title"),
    content: formData.get("content") || undefined,
    type: formData.get("type") || existing.type,
    published: formData.get("published") === "true",
    projectId: formData.get("projectId") || existing.projectId || undefined,
  });

  if (!parsed.success) return { error: "Invalid input", fieldErrors: parsed.error.flatten().fieldErrors };

  // If content changed, save previous version
  const contentChanged = existing.content !== (parsed.data.content || null);
  if (contentChanged && existing.content) {
    await db.documentVersion.create({
      data: {
        version: existing.version,
        content: existing.content,
        changelog,
        documentId: id,
      },
    });
  }

  await db.document.update({
    where: { id },
    data: {
      ...parsed.data,
      version: contentChanged ? existing.version + 1 : existing.version,
    },
  });

  await logActivity("updated", "document", id, user.id, parsed.data.title);
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

  await db.document.delete({ where: { id } });
  await logActivity("deleted", "document", id, user.id, doc.title);
  revalidatePath(`/projects/${doc.projectId}`);
  return { success: true };
}

export async function restoreDocumentVersion(_prev: unknown, formData: FormData) {
  const user = await requireAuth();
  const perms = await resolveModulePerms(user.id, user.role, "projects");
  if (!perms.canEdit) return { error: "Permission denied" };

  const documentId = formData.get("documentId") as string;
  const versionId = formData.get("versionId") as string;

  const doc = await db.document.findUnique({ where: { id: documentId } });
  if (!doc) return { error: "Document not found" };

  const version = await db.documentVersion.findUnique({ where: { id: versionId } });
  if (!version) return { error: "Version not found" };

  // Save current content as a version before restoring
  if (doc.content) {
    await db.documentVersion.create({
      data: {
        version: doc.version,
        content: doc.content,
        changelog: `Before restoring to v${version.version}`,
        documentId,
      },
    });
  }

  await db.document.update({
    where: { id: documentId },
    data: {
      content: version.content,
      version: doc.version + 1,
    },
  });

  await logActivity("updated", "document", documentId, user.id, `Restored to v${version.version}`);
  revalidatePath(`/projects/${doc.projectId}/documents/${documentId}`);
  revalidatePath(`/projects/${doc.projectId}`);
  return { success: true };
}
