"use server";

import { db } from "@/lib/db";
import { requireAuth, resolveModulePerms } from "@/lib/permissions";
import { logActivity } from "@/lib/activity";
import { MAX_RECEIPT_UPLOAD_BYTES, describeMaxUpload } from "@/lib/upload-limits";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { nameField } from "@/lib/validation";
import { normalizeSupplierCategory } from "@/lib/supplier-categories";
import { asUploadedFile } from "@/lib/uploaded-file";
import { blobToBuffer, deleteFile, uploadFile, StorageQuotaExceededError } from "@/lib/storage";
import { sniffUploadType } from "@/lib/upload-validation";
import { log } from "@/lib/log";

/**
 * Resolve the category value from the form. The picker offers existing
 * categories plus an "Add new category…" sentinel — when chosen, the
 * free-text `newCategory` input is normalized to the snake_case shape
 * the existing categories use ("Fleet Maintenance" → "fleet_maintenance")
 * so it groups/filters consistently and shows up in the picker next time.
 */
function resolveCategory(formData: FormData): { category?: string; error?: string } {
  const raw = (formData.get("category") as string | null)?.trim() ?? "";
  const newCategory = (formData.get("newCategory") as string | null)?.trim() ?? "";
  if (raw === "__new__" || (!raw && newCategory)) {
    if (!newCategory) return { error: "Enter a name for the new category" };
    const normalized = normalizeSupplierCategory(newCategory);
    if (!normalized) return { error: "Enter a name for the new category" };
    return { category: normalized };
  }
  if (!raw) return { error: "Category is required" };
  return { category: raw };
}

const supplierSchema = z.object({
  name: nameField({ label: "Name" }),
  category: z.string().min(1, "Category is required"),
  contactName: z.string().optional(),
  contactTitle: z.string().optional(),
  contactEmail: z.string().email().optional().or(z.literal("")),
  contactPhone: z.string().optional(),
  location: z.string().optional(),
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

  const resolvedCategory = resolveCategory(formData);
  if (resolvedCategory.error) return { error: resolvedCategory.error };

  const parsed = supplierSchema.safeParse({
    name: formData.get("name"),
    category: resolvedCategory.category,
    contactName: formData.get("contactName") || undefined,
    contactTitle: formData.get("contactTitle") || undefined,
    contactEmail: formData.get("contactEmail") || undefined,
    contactPhone: formData.get("contactPhone") || undefined,
    location: formData.get("location") || undefined,
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
  const resolvedCategory = resolveCategory(formData);
  if (resolvedCategory.error) return { error: resolvedCategory.error };

  const parsed = supplierSchema.safeParse({
    name: formData.get("name"),
    category: resolvedCategory.category,
    contactName: formData.get("contactName") || undefined,
    contactTitle: formData.get("contactTitle") || undefined,
    contactEmail: formData.get("contactEmail") || undefined,
    contactPhone: formData.get("contactPhone") || undefined,
    location: formData.get("location") || undefined,
    address: formData.get("address") || undefined,
    website: formData.get("website") || undefined,
    notes: formData.get("notes") || undefined,
    status: formData.get("status") || undefined,
    isPreferred: formData.get("isPreferred") === "true",
  });

  if (!parsed.success) return { error: "Invalid input", fieldErrors: parsed.error.flatten().fieldErrors };

  // Existence + soft-delete guard: a missing id would throw P2025 (→ 500)
  // and a soft-deleted supplier must not be editable from a stale form.
  const existing = await db.supplier.findFirst({
    where: { id, deletedAt: null },
    select: { id: true },
  });
  if (!existing) return { error: "Not found" };

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

  // Both ends of the link must exist (and not be soft-deleted) — a bad
  // FK would otherwise throw P2003 (→ 500).
  const [supplier, project] = await Promise.all([
    db.supplier.findFirst({ where: { id: supplierId, deletedAt: null }, select: { id: true } }),
    db.project.findFirst({ where: { id: projectId, deletedAt: null }, select: { id: true } }),
  ]);
  if (!supplier || !project) return { error: "Not found" };

  const existing = await db.supplierProject.findUnique({
    where: { supplierId_projectId: { supplierId, projectId } },
  });
  if (existing) return { error: "Already linked" };

  await db.supplierProject.create({ data: { supplierId, projectId, notes } });
  revalidatePath(`/suppliers/${supplierId}`);
  revalidatePath(`/projects/${projectId}`);
  return { success: true };
}

export async function unlinkSupplierProject(_prev: unknown, formData: FormData) {
  const user = await requireAuth();
  const perms = await resolveModulePerms(user.id, user.role, "suppliers");
  if (!perms.canEdit) return { error: "Permission denied" };

  const id = formData.get("id") as string;
  // Look up the link first — a stale double-submit would otherwise throw
  // P2025 (→ 500), and we need both ids for revalidation anyway.
  const link = await db.supplierProject.findUnique({ where: { id } });
  if (!link) return { error: "Not found" };

  await db.supplierProject.delete({ where: { id } });
  revalidatePath(`/suppliers/${link.supplierId}`);
  revalidatePath(`/projects/${link.projectId}`);
  return { success: true };
}

// ─── Supplier contacts ────────────────────────────────────────────
//
// Additional contacts beyond the flat primary fields — AP departments,
// dispatchers, personal vs company emails. Same shape and semantics as
// client contacts; suppliers aren't a scoped entity type, so the gates
// are module-level only.

const supplierContactSchema = z.object({
  name: nameField({ label: "Name" }),
  title: z.string().optional(),
  email: z.string().email().optional().or(z.literal("")),
  phone: z.string().optional(),
  isPrimary: z.boolean().optional(),
  notes: z.string().optional(),
  supplierId: z.string().min(1),
});

export async function createSupplierContact(_prev: unknown, formData: FormData) {
  const user = await requireAuth();
  const perms = await resolveModulePerms(user.id, user.role, "suppliers");
  if (!perms.canEdit) return { error: "Permission denied" };

  const parsed = supplierContactSchema.safeParse({
    name: formData.get("name"),
    title: formData.get("title") || undefined,
    email: formData.get("email") || undefined,
    phone: formData.get("phone") || undefined,
    isPrimary: formData.get("isPrimary") === "true",
    notes: formData.get("notes") || undefined,
    supplierId: formData.get("supplierId"),
  });
  if (!parsed.success) return { error: "Invalid input", fieldErrors: parsed.error.flatten().fieldErrors };

  const supplier = await db.supplier.findFirst({
    where: { id: parsed.data.supplierId, deletedAt: null },
    select: { id: true },
  });
  if (!supplier) return { error: "Not found" };

  if (parsed.data.isPrimary) {
    await db.supplierContact.updateMany({
      where: { supplierId: parsed.data.supplierId, isPrimary: true },
      data: { isPrimary: false },
    });
  }

  const contact = await db.supplierContact.create({ data: parsed.data });
  await logActivity("created", "supplier-contact", contact.id, user.id, contact.name);
  revalidatePath(`/suppliers/${parsed.data.supplierId}`);
  return { success: true };
}

export async function updateSupplierContact(_prev: unknown, formData: FormData) {
  const user = await requireAuth();
  const perms = await resolveModulePerms(user.id, user.role, "suppliers");
  if (!perms.canEdit) return { error: "Permission denied" };

  const id = formData.get("id") as string;
  const parsed = supplierContactSchema.safeParse({
    name: formData.get("name"),
    title: formData.get("title") || undefined,
    email: formData.get("email") || undefined,
    phone: formData.get("phone") || undefined,
    isPrimary: formData.get("isPrimary") === "true",
    notes: formData.get("notes") || undefined,
    supplierId: formData.get("supplierId"),
  });
  if (!parsed.success) return { error: "Invalid input", fieldErrors: parsed.error.flatten().fieldErrors };

  const existing = await db.supplierContact.findFirst({
    where: { id, supplierId: parsed.data.supplierId },
    select: { id: true },
  });
  if (!existing) return { error: "Not found" };

  if (parsed.data.isPrimary) {
    await db.supplierContact.updateMany({
      where: { supplierId: parsed.data.supplierId, isPrimary: true, id: { not: id } },
      data: { isPrimary: false },
    });
  }

  await db.supplierContact.update({ where: { id }, data: parsed.data });
  await logActivity("updated", "supplier-contact", id, user.id, parsed.data.name);
  revalidatePath(`/suppliers/${parsed.data.supplierId}`);
  return { success: true };
}

export async function deleteSupplierContact(_prev: unknown, formData: FormData) {
  const user = await requireAuth();
  const perms = await resolveModulePerms(user.id, user.role, "suppliers");
  if (!perms.canEdit) return { error: "Permission denied" };

  const id = formData.get("id") as string;
  const contact = await db.supplierContact.findUnique({
    where: { id },
    select: { id: true, name: true, supplierId: true },
  });
  if (!contact) return { error: "Not found" };

  await db.supplierContact.delete({ where: { id } });
  await logActivity("deleted", "supplier-contact", id, user.id, contact.name);
  revalidatePath(`/suppliers/${contact.supplierId}`);
  return { success: true };
}

// ─── Supplier receipts ────────────────────────────────────────────
//
// Transaction receipts attached to the supplier. Stored through the
// storage layer as PRIVATE files with category "receipt"; served via
// /api/files/{id} which enforces per-entity authz (lib/file-authz
// already grants supplier files to anyone who can view the supplier).


export async function uploadSupplierReceipt(_prev: unknown, formData: FormData) {
  const user = await requireAuth();
  const perms = await resolveModulePerms(user.id, user.role, "suppliers");
  if (!perms.canUpload) return { error: "Permission denied" };

  const supplierId = formData.get("supplierId") as string;
  const supplier = await db.supplier.findFirst({
    where: { id: supplierId, deletedAt: null },
    select: { id: true, name: true },
  });
  if (!supplier) return { error: "Not found" };

  const blob = asUploadedFile(formData.get("file"));
  if (!blob) return { error: "No file provided" };
  if (blob.size === 0) return { error: "File is empty" };
  if (blob.size > MAX_RECEIPT_UPLOAD_BYTES) {
    return { error: `File exceeds the ${describeMaxUpload(MAX_RECEIPT_UPLOAD_BYTES)} limit` };
  }

  const buffer = await blobToBuffer(blob as unknown as Blob);
  // Receipts are private, but sniff anyway so a mislabeled executable
  // can't be stored under an image content type.
  const sniff = sniffUploadType(buffer, blob.type, { blockSvg: true });
  if (!sniff.ok) return { error: sniff.reason };

  try {
    await uploadFile({
      content: buffer,
      filename: blob.name,
      contentType: blob.type,
      uploadedById: user.id,
      visibility: "private",
      supplierId,
      category: "receipt",
    });
  } catch (err) {
    if (err instanceof StorageQuotaExceededError) {
      return { error: "Your account is at its storage quota. Delete older files first." };
    }
    log.error("suppliers.receipt", "Storage driver failed", err);
    return { error: "Upload failed — check storage configuration and server logs." };
  }

  await logActivity("uploaded", "supplier-receipt", supplierId, user.id, blob.name);
  revalidatePath(`/suppliers/${supplierId}`);
  return { success: true };
}

export async function deleteSupplierReceipt(_prev: unknown, formData: FormData) {
  const user = await requireAuth();
  const perms = await resolveModulePerms(user.id, user.role, "suppliers");

  const fileId = formData.get("fileId") as string;
  const file = await db.file.findUnique({
    where: { id: fileId },
    select: { id: true, name: true, supplierId: true, uploadedById: true, category: true },
  });
  if (!file || !file.supplierId || file.category !== "receipt") return { error: "Not found" };

  // Uploaders can remove their own receipt; anything else needs delete.
  if (!(perms.canDelete || (perms.canUpload && file.uploadedById === user.id))) {
    return { error: "Permission denied" };
  }

  await deleteFile(fileId);
  await logActivity("deleted", "supplier-receipt", file.supplierId, user.id, file.name);
  revalidatePath(`/suppliers/${file.supplierId}`);
  return { success: true };
}
