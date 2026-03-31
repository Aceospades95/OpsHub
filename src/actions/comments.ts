"use server";

import { db } from "@/lib/db";
import { requireAuth, resolveModulePerms } from "@/lib/permissions";
import { logActivity } from "@/lib/activity";
import { revalidatePath } from "next/cache";
import { z } from "zod";

const entityModuleMap: Record<string, string> = {
  client: "clients",
  project: "projects",
  contract: "contracts",
  document: "projects",
  supplier: "suppliers",
};

const addCommentSchema = z.object({
  entityType: z.enum(["client", "project", "contract", "document", "supplier"]),
  entityId: z.string().min(1),
  content: z.string().min(1, "Comment cannot be empty"),
});

export async function addComment(_prev: unknown, formData: FormData) {
  const user = await requireAuth();
  const parsed = addCommentSchema.safeParse({
    entityType: formData.get("entityType"),
    entityId: formData.get("entityId"),
    content: formData.get("content"),
  });

  if (!parsed.success) {
    return { error: "Invalid input", fieldErrors: parsed.error.flatten().fieldErrors };
  }

  const { entityType, entityId, content } = parsed.data;
  const moduleName = entityModuleMap[entityType];
  const perms = await resolveModulePerms(user.id, user.role, moduleName);

  if (!perms.canComment) {
    return { error: "You don't have permission to comment" };
  }

  const data: Record<string, unknown> = {
    content,
    authorId: user.id,
    [`${entityType}Id`]: entityId,
  };

  await db.comment.create({ data: data as never });
  await logActivity("commented", entityType, entityId, user.id, content.slice(0, 100));
  revalidatePath("/");
  return { success: true };
}

export async function deleteComment(_prev: unknown, formData: FormData) {
  const user = await requireAuth();
  const commentId = formData.get("commentId") as string;

  const comment = await db.comment.findUnique({ where: { id: commentId } });
  if (!comment) return { error: "Comment not found" };

  // Allow delete if user is author or has delete permission
  if (comment.authorId !== user.id) {
    const entityType = comment.clientId
      ? "client"
      : comment.projectId
        ? "project"
        : comment.contractId
          ? "contract"
          : comment.documentId
            ? "document"
            : "supplier";
    const moduleName = entityModuleMap[entityType];
    const perms = await resolveModulePerms(user.id, user.role, moduleName);
    if (!perms.canDelete) {
      return { error: "You don't have permission to delete this comment" };
    }
  }

  await db.comment.delete({ where: { id: commentId } });
  revalidatePath("/");
  return { success: true };
}
