"use server";

import { db } from "@/lib/db";
import { requireAuth, resolveModulePerms } from "@/lib/permissions";
import { logActivity } from "@/lib/activity";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { nameField } from "@/lib/validation";

const supplierSchema = z.object({
  name: nameField({ label: "Name" }),
  category: z.string().min(1, "Category is required"),
  contactName: z.string().optional(),
  contactEmail: z.string().optional(),
  contactPhone: z.string().optional(),
  address: z.string().optional(),
  website: z.string().optional(),
  notes: z.string().optional(),
  status: z.enum(["ACTIVE", "INACTIVE", "ARCHIVED"]).optional(),
  isPreferred: z.boolean().optional(),
});

export async function createSupplier(_prev: unknown, formData: FormData) {
  const user = await requireAuth();
  const perms = await resolveModulePerms(user.id, user.role, "suppliers");
  if (!perms.canCreate) return { error: "Permission denied" };

  const parsed = supplierSchema.safeParse({
    name: formData.get("name"),
    category: formData.get("category"),
    contactName: formData.get("contactName") || undefined,
    contactEmail: formData.get("contactEmail") || undefined,
    contactPhone: formData.get("contactPhone") || undefined,
    address: formData.get("address") || undefined,
    website: formData.get("website") || undefined,
    notes: formData.get("notes") || undefined,
    status: formData.get("status") || "ACTIVE",
    isPreferred: formData.get("isPreferred") === "true",
  });

  if (!parsed.success) return { error: "Invalid input", fieldErrors: parsed.error.flatten().fieldErrors };

  const supplier = await db.supplier.create({ data: parsed.data });
  await logActivity("created", "supplier", supplier.id, user.id, supplier.name);
  revalidatePath("/suppliers");
  return { success: true };
}

export async function updateSupplier(_prev: unknown, formData: FormData) {
  const user = await requireAuth();
  const perms = await resolveModulePerms(user.id, user.role, "suppliers");
  if (!perms.canEdit) return { error: "Permission denied" };

  const id = formData.get("id") as string;
  const parsed = supplierSchema.safeParse({
    name: formData.get("name"),
    category: formData.get("category"),
    contactName: formData.get("contactName") || undefined,
    contactEmail: formData.get("contactEmail") || undefined,
    contactPhone: formData.get("contactPhone") || undefined,
    address: formData.get("address") || undefined,
    website: formData.get("website") || undefined,
    notes: formData.get("notes") || undefined,
    status: formData.get("status") || undefined,
    isPreferred: formData.get("isPreferred") === "true",
  });

  if (!parsed.success) return { error: "Invalid input", fieldErrors: parsed.error.flatten().fieldErrors };

  await db.supplier.update({ where: { id }, data: parsed.data });
  await logActivity("updated", "supplier", id, user.id, parsed.data.name);
  revalidatePath(`/suppliers/${id}`);
  revalidatePath("/suppliers");
  return { success: true };
}

export async function deleteSupplier(_prev: unknown, formData: FormData) {
  const user = await requireAuth();
  const perms = await resolveModulePerms(user.id, user.role, "suppliers");
  if (!perms.canDelete) return { error: "Permission denied" };

  const id = formData.get("id") as string;
  const supplier = await db.supplier.findUnique({ where: { id } });
  if (!supplier) return { error: "Not found" };
  if (supplier.deletedAt) {
    return { error: "Already in the recovery bin" };
  }

  await db.supplier.update({ where: { id }, data: { deletedAt: new Date() } });
  await logActivity("soft-deleted", "supplier", id, user.id, supplier.name);
  revalidatePath("/suppliers");
  return { success: true };
}

export async function linkSupplierProject(_prev: unknown, formData: FormData) {
  const user = await requireAuth();
  const perms = await resolveModulePerms(user.id, user.role, "suppliers");
  if (!perms.canEdit) return { error: "Permission denied" };

  const supplierId = formData.get("supplierId") as string;
  const projectId = formData.get("projectId") as string;
  const notes = formData.get("notes") as string || undefined;

  const existing = await db.supplierProject.findUnique({
    where: { supplierId_projectId: { supplierId, projectId } },
  });
  if (existing) return { error: "Already linked" };

  await db.supplierProject.create({ data: { supplierId, projectId, notes } });
  revalidatePath(`/suppliers/${supplierId}`);
  return { success: true };
}

export async function unlinkSupplierProject(_prev: unknown, formData: FormData) {
  const user = await requireAuth();
  const perms = await resolveModulePerms(user.id, user.role, "suppliers");
  if (!perms.canEdit) return { error: "Permission denied" };

  const id = formData.get("id") as string;
  await db.supplierProject.delete({ where: { id } });
  revalidatePath("/suppliers");
  return { success: true };
}
