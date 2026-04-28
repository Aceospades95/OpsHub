"use server";

import { db } from "@/lib/db";
import { requireAuth, resolveModulePerms } from "@/lib/permissions";
import { revalidatePath } from "next/cache";
import { z } from "zod";

// Catalog items are part of the quotes module — no separate `catalog`
// permission key. Anyone who can edit quotes can manage the catalog.

const catalogItemSchema = z.object({
  name: z.string().min(1, "Name is required"),
  description: z.string().optional().nullable(),
  defaultUnitPrice: z.coerce.number().min(0).default(0),
  defaultUnit: z.string().optional().nullable(),
  category: z.string().optional().nullable(),
  isRecurring: z.boolean().optional(),
  isActive: z.boolean().optional(),
});

function normalizeOptional(v: string | null | undefined): string | null {
  if (v == null) return null;
  const t = String(v).trim();
  return t.length === 0 ? null : t;
}

export async function createCatalogItem(_prev: unknown, formData: FormData) {
  const user = await requireAuth();
  const perms = await resolveModulePerms(user.id, user.role, "quotes");
  if (!perms.canCreate) return { error: "Permission denied" };

  const parsed = catalogItemSchema.safeParse({
    name: formData.get("name"),
    description: formData.get("description") || undefined,
    defaultUnitPrice: formData.get("defaultUnitPrice") || 0,
    defaultUnit: formData.get("defaultUnit") || undefined,
    category: formData.get("category") || undefined,
    isRecurring: formData.get("isRecurring") === "true",
    isActive: formData.get("isActive") !== "false",
  });
  if (!parsed.success) {
    return { error: "Invalid input", fieldErrors: parsed.error.flatten().fieldErrors };
  }

  await db.catalogItem.create({
    data: {
      name: parsed.data.name,
      description: normalizeOptional(parsed.data.description ?? null),
      defaultUnitPrice: parsed.data.defaultUnitPrice,
      defaultUnit: normalizeOptional(parsed.data.defaultUnit ?? null),
      category: normalizeOptional(parsed.data.category ?? null),
      isRecurring: parsed.data.isRecurring ?? false,
      isActive: parsed.data.isActive ?? true,
    },
  });
  revalidatePath("/quotes/catalog");
  return { success: true };
}

export async function updateCatalogItem(_prev: unknown, formData: FormData) {
  const user = await requireAuth();
  const perms = await resolveModulePerms(user.id, user.role, "quotes");
  if (!perms.canEdit) return { error: "Permission denied" };

  const id = formData.get("id") as string;
  if (!id) return { error: "Item id is required" };

  const parsed = catalogItemSchema.safeParse({
    name: formData.get("name"),
    description: formData.get("description") || undefined,
    defaultUnitPrice: formData.get("defaultUnitPrice") || 0,
    defaultUnit: formData.get("defaultUnit") || undefined,
    category: formData.get("category") || undefined,
    isRecurring: formData.get("isRecurring") === "true",
    isActive: formData.get("isActive") !== "false",
  });
  if (!parsed.success) {
    return { error: "Invalid input", fieldErrors: parsed.error.flatten().fieldErrors };
  }

  await db.catalogItem.update({
    where: { id },
    data: {
      name: parsed.data.name,
      description: normalizeOptional(parsed.data.description ?? null),
      defaultUnitPrice: parsed.data.defaultUnitPrice,
      defaultUnit: normalizeOptional(parsed.data.defaultUnit ?? null),
      category: normalizeOptional(parsed.data.category ?? null),
      isRecurring: parsed.data.isRecurring ?? false,
      isActive: parsed.data.isActive ?? true,
    },
  });
  revalidatePath("/quotes/catalog");
  return { success: true };
}

export async function deleteCatalogItem(_prev: unknown, formData: FormData) {
  const user = await requireAuth();
  const perms = await resolveModulePerms(user.id, user.role, "quotes");
  if (!perms.canDelete) return { error: "Permission denied" };

  const id = formData.get("id") as string;
  if (!id) return { error: "Item id is required" };

  // Soft-delete by deactivating: existing quote/template line items still
  // reference the row via catalogItemId. Hard-deletion would orphan those
  // references (onDelete: SetNull blanks them, losing the linkage).
  await db.catalogItem.update({ where: { id }, data: { isActive: false } });
  revalidatePath("/quotes/catalog");
  return { success: true };
}

export async function searchCatalogItems(query: string, limit = 10) {
  const user = await requireAuth();
  const perms = await resolveModulePerms(user.id, user.role, "quotes");
  if (!perms.canView) return [];

  const trimmed = query.trim();
  if (trimmed.length === 0) {
    return db.catalogItem.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
      take: limit,
    });
  }

  return db.catalogItem.findMany({
    where: {
      isActive: true,
      OR: [
        { name: { contains: trimmed, mode: "insensitive" } },
        { description: { contains: trimmed, mode: "insensitive" } },
        { category: { contains: trimmed, mode: "insensitive" } },
      ],
    },
    orderBy: { name: "asc" },
    take: limit,
  });
}
