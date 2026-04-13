"use server";

import { db } from "@/lib/db";
import { requireAuth, canAccessSandbox } from "@/lib/permissions";
import { logActivity } from "@/lib/activity";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { Role } from "@prisma/client";

function requireSandboxAccess(role: string) {
  if (!canAccessSandbox(role as Role)) {
    throw new Error("Sandbox access requires Developer or Admin role");
  }
}

const sandboxPageSchema = z.object({
  title: z.string().min(1, "Title is required"),
  slug: z.string().min(1, "Slug is required").regex(/^[a-z0-9-]+$/, "Slug must be lowercase letters, numbers, and hyphens only"),
  description: z.string().optional(),
  content: z.string().optional(),
  layout: z.enum(["default", "wide", "full"]).default("default"),
  icon: z.string().optional(),
  projectId: z.string().optional(),
  clientId: z.string().optional(),
});

export async function createSandboxPage(_prev: unknown, formData: FormData) {
  const user = await requireAuth();
  requireSandboxAccess(user.role);

  const parsed = sandboxPageSchema.safeParse({
    title: formData.get("title"),
    slug: formData.get("slug"),
    description: formData.get("description") || undefined,
    content: formData.get("content") || undefined,
    layout: formData.get("layout") || "default",
    icon: formData.get("icon") || undefined,
    projectId: formData.get("projectId") || undefined,
    clientId: formData.get("clientId") || undefined,
  });

  if (!parsed.success) {
    return { error: "Invalid input", fieldErrors: parsed.error.flatten().fieldErrors };
  }

  const existing = await db.sandboxPage.findUnique({ where: { slug: parsed.data.slug } });
  if (existing) return { error: "A page with this slug already exists" };

  const page = await db.sandboxPage.create({
    data: {
      title: parsed.data.title,
      slug: parsed.data.slug,
      description: parsed.data.description || null,
      content: parsed.data.content || null,
      layout: parsed.data.layout,
      icon: parsed.data.icon || null,
      projectId: parsed.data.projectId || null,
      clientId: parsed.data.clientId || null,
      createdById: user.id,
    },
  });

  await logActivity("created", "sandboxPage", page.id, user.id, page.title);
  revalidatePath("/sandbox");
  return { success: true };
}

export async function updateSandboxPage(_prev: unknown, formData: FormData) {
  const user = await requireAuth();
  requireSandboxAccess(user.role);

  const id = formData.get("id") as string;
  const page = await db.sandboxPage.findUnique({ where: { id } });
  if (!page) return { error: "Page not found" };

  if (page.createdById !== user.id && user.role !== "ADMIN") {
    return { error: "You can only edit your own sandbox pages" };
  }

  const parsed = sandboxPageSchema.safeParse({
    title: formData.get("title"),
    slug: formData.get("slug"),
    description: formData.get("description") || undefined,
    content: formData.get("content") || undefined,
    layout: formData.get("layout") || "default",
    icon: formData.get("icon") || undefined,
    projectId: formData.get("projectId") || undefined,
    clientId: formData.get("clientId") || undefined,
  });

  if (!parsed.success) {
    return { error: "Invalid input", fieldErrors: parsed.error.flatten().fieldErrors };
  }

  const slugConflict = await db.sandboxPage.findUnique({ where: { slug: parsed.data.slug } });
  if (slugConflict && slugConflict.id !== id) {
    return { error: "A page with this slug already exists" };
  }

  await db.sandboxPage.update({
    where: { id },
    data: {
      title: parsed.data.title,
      slug: parsed.data.slug,
      description: parsed.data.description || null,
      content: parsed.data.content || null,
      layout: parsed.data.layout,
      icon: parsed.data.icon || null,
      projectId: parsed.data.projectId || null,
      clientId: parsed.data.clientId || null,
    },
  });

  await logActivity("updated", "sandboxPage", id, user.id, parsed.data.title);
  revalidatePath(`/sandbox/${id}`);
  revalidatePath("/sandbox");
  return { success: true };
}

export async function deleteSandboxPage(_prev: unknown, formData: FormData) {
  const user = await requireAuth();
  requireSandboxAccess(user.role);

  const id = formData.get("id") as string;
  const page = await db.sandboxPage.findUnique({ where: { id } });
  if (!page) return { error: "Page not found" };

  if (page.createdById !== user.id && user.role !== "ADMIN") {
    return { error: "You can only delete your own sandbox pages" };
  }

  await db.sandboxPage.delete({ where: { id } });
  await logActivity("deleted", "sandboxPage", id, user.id, page.title);
  revalidatePath("/sandbox");
  return { success: true };
}

export async function toggleSandboxPublished(_prev: unknown, formData: FormData) {
  const user = await requireAuth();

  if (user.role !== "ADMIN") {
    return { error: "Only admins can publish or unpublish sandbox pages" };
  }

  const id = formData.get("id") as string;
  const page = await db.sandboxPage.findUnique({ where: { id } });
  if (!page) return { error: "Page not found" };

  await db.sandboxPage.update({
    where: { id },
    data: { published: !page.published },
  });

  await logActivity(
    page.published ? "unpublished" : "published",
    "sandboxPage",
    id,
    user.id,
    page.title
  );

  revalidatePath(`/sandbox/${id}`);
  revalidatePath("/sandbox");
  return { success: true };
}
