"use server";

import { db } from "@/lib/db";
import { requireAuth, resolveModulePerms } from "@/lib/permissions";
import { logActivity } from "@/lib/activity";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { nameField } from "@/lib/validation";

const resourceSchema = z.object({
  title: nameField({ label: "Title" }),
  description: z.string().optional(),
  content: z.string().optional(),
  category: z.enum(["EXPENSE_REPORT", "TIME_OFF", "ORG_CHART", "ANNOUNCEMENT", "HR_POLICY", "SOP", "GENERAL_RESOURCE", "FORM", "OTHER"]).optional(),
  published: z.boolean().optional(),
  pinned: z.boolean().optional(),
  sortOrder: z.coerce.number().int().optional(),
});

export async function createIntranetResource(_prev: unknown, formData: FormData) {
  const user = await requireAuth();
  const perms = await resolveModulePerms(user.id, user.role, "intranet");
  if (!perms.canCreate) return { error: "Permission denied" };

  const parsed = resourceSchema.safeParse({
    title: formData.get("title"),
    description: formData.get("description") || undefined,
    content: formData.get("content") || undefined,
    category: formData.get("category") || "OTHER",
    published: formData.get("published") === "true",
    pinned: formData.get("pinned") === "true",
    sortOrder: formData.get("sortOrder") || 0,
  });

  if (!parsed.success) return { error: "Invalid input", fieldErrors: parsed.error.flatten().fieldErrors };

  const resource = await db.intranetResource.create({ data: parsed.data });
  await logActivity("created", "intranet", resource.id, user.id, resource.title);
  revalidatePath("/intranet");
  return { success: true };
}

export async function updateIntranetResource(_prev: unknown, formData: FormData) {
  const user = await requireAuth();
  const perms = await resolveModulePerms(user.id, user.role, "intranet");
  if (!perms.canEdit) return { error: "Permission denied" };

  const id = formData.get("id") as string;
  const parsed = resourceSchema.safeParse({
    title: formData.get("title"),
    description: formData.get("description") || undefined,
    content: formData.get("content") || undefined,
    category: formData.get("category") || undefined,
    published: formData.get("published") === "true",
    pinned: formData.get("pinned") === "true",
    sortOrder: formData.get("sortOrder") || 0,
  });

  if (!parsed.success) return { error: "Invalid input", fieldErrors: parsed.error.flatten().fieldErrors };

  await db.intranetResource.update({ where: { id }, data: parsed.data });
  await logActivity("updated", "intranet", id, user.id, parsed.data.title);
  revalidatePath(`/intranet/${id}`);
  revalidatePath("/intranet");
  return { success: true };
}

export async function deleteIntranetResource(_prev: unknown, formData: FormData) {
  const user = await requireAuth();
  const perms = await resolveModulePerms(user.id, user.role, "intranet");
  if (!perms.canDelete) return { error: "Permission denied" };

  const id = formData.get("id") as string;
  const resource = await db.intranetResource.findUnique({ where: { id } });
  if (!resource) return { error: "Not found" };

  await db.intranetResource.delete({ where: { id } });
  await logActivity("deleted", "intranet", id, user.id, resource.title);
  revalidatePath("/intranet");
  return { success: true };
}
