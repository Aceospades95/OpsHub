"use server";

import { db } from "@/lib/db";
import { requireAuth, resolveModulePerms } from "@/lib/permissions";
import { logActivity } from "@/lib/activity";
import { revalidateSubcontractor } from "@/lib/revalidate-entity";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { nameField } from "@/lib/validation";

const subcontractorSchema = z.object({
  name: nameField({ label: "Name" }),
  legalName: z.string().optional(),
  type: z.enum(["INDIVIDUAL", "COMPANY", "AGENCY"]).optional(),
  status: z.enum(["ACTIVE", "INACTIVE", "ONBOARDING", "SUSPENDED", "ARCHIVED"]).optional(),
  description: z.string().optional(),
  summary: z.string().optional(),
  specialties: z.string().optional(), // comma-separated in form, parsed below
  primaryContactName: z.string().optional(),
  primaryContactEmail: z.string().email().optional().or(z.literal("")),
  primaryContactPhone: z.string().optional(),
  website: z.string().optional(),
  address: z.string().optional(),
  taxId: z.string().optional(),
  businessLicense: z.string().optional(),
  defaultRate: z.string().optional(),
  rateUnit: z.string().optional(),
  currency: z.string().optional(),
  paymentTerms: z.string().optional(),
  insuranceExpiresAt: z.string().optional(),
  w9OnFile: z.boolean().optional(),
  msaSignedAt: z.string().optional(),
  ndaSignedAt: z.string().optional(),
  complianceStatus: z.enum(["COMPLIANT", "PENDING", "EXPIRED", "NON_COMPLIANT"]).optional(),
  complianceNotes: z.string().optional(),
  isPreferred: z.boolean().optional(),
  rating: z.string().optional(),
  accountManagerId: z.string().optional(),
  notes: z.string().optional(),
});

function parseFormData(formData: FormData) {
  return subcontractorSchema.safeParse({
    name: formData.get("name"),
    legalName: formData.get("legalName") || undefined,
    type: formData.get("type") || undefined,
    status: formData.get("status") || undefined,
    description: formData.get("description") || undefined,
    summary: formData.get("summary") || undefined,
    specialties: formData.get("specialties") || undefined,
    primaryContactName: formData.get("primaryContactName") || undefined,
    primaryContactEmail: formData.get("primaryContactEmail") || undefined,
    primaryContactPhone: formData.get("primaryContactPhone") || undefined,
    website: formData.get("website") || undefined,
    address: formData.get("address") || undefined,
    taxId: formData.get("taxId") || undefined,
    businessLicense: formData.get("businessLicense") || undefined,
    defaultRate: formData.get("defaultRate") || undefined,
    rateUnit: formData.get("rateUnit") || undefined,
    currency: formData.get("currency") || undefined,
    paymentTerms: formData.get("paymentTerms") || undefined,
    insuranceExpiresAt: formData.get("insuranceExpiresAt") || undefined,
    w9OnFile: formData.get("w9OnFile") === "true",
    msaSignedAt: formData.get("msaSignedAt") || undefined,
    ndaSignedAt: formData.get("ndaSignedAt") || undefined,
    complianceStatus: formData.get("complianceStatus") || undefined,
    complianceNotes: formData.get("complianceNotes") || undefined,
    isPreferred: formData.get("isPreferred") === "true",
    rating: formData.get("rating") || undefined,
    accountManagerId: formData.get("accountManagerId") || undefined,
    notes: formData.get("notes") || undefined,
  });
}

function toDb(parsed: z.infer<typeof subcontractorSchema>) {
  const specialties = parsed.specialties
    ? parsed.specialties
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : undefined;
  return {
    name: parsed.name,
    legalName: parsed.legalName || null,
    type: parsed.type,
    status: parsed.status,
    description: parsed.description || null,
    summary: parsed.summary || null,
    specialties,
    primaryContactName: parsed.primaryContactName || null,
    primaryContactEmail: parsed.primaryContactEmail || null,
    primaryContactPhone: parsed.primaryContactPhone || null,
    website: parsed.website || null,
    address: parsed.address || null,
    taxId: parsed.taxId || null,
    businessLicense: parsed.businessLicense || null,
    defaultRate: parsed.defaultRate ? Number(parsed.defaultRate) : null,
    rateUnit: parsed.rateUnit || null,
    currency: parsed.currency || "USD",
    paymentTerms: parsed.paymentTerms || null,
    insuranceExpiresAt: parsed.insuranceExpiresAt ? new Date(parsed.insuranceExpiresAt) : null,
    w9OnFile: parsed.w9OnFile ?? false,
    msaSignedAt: parsed.msaSignedAt ? new Date(parsed.msaSignedAt) : null,
    ndaSignedAt: parsed.ndaSignedAt ? new Date(parsed.ndaSignedAt) : null,
    complianceStatus: parsed.complianceStatus,
    complianceNotes: parsed.complianceNotes || null,
    isPreferred: parsed.isPreferred ?? false,
    rating: parsed.rating ? Number(parsed.rating) : null,
    accountManagerId: parsed.accountManagerId || null,
    notes: parsed.notes || null,
  };
}

export async function createSubcontractor(_prev: unknown, formData: FormData) {
  const user = await requireAuth();
  const perms = await resolveModulePerms(user.id, user.role, "subcontractors");
  if (!perms.canCreate) return { error: "Permission denied" };

  const parsed = parseFormData(formData);
  if (!parsed.success) {
    return { error: "Invalid input", fieldErrors: parsed.error.flatten().fieldErrors };
  }

  const sub = await db.subcontractor.create({ data: toDb(parsed.data) });
  await logActivity("created", "subcontractor", sub.id, user.id, sub.name);
  revalidateSubcontractor(sub.id);
  return { success: true };
}

export async function updateSubcontractor(_prev: unknown, formData: FormData) {
  const user = await requireAuth();
  const perms = await resolveModulePerms(user.id, user.role, "subcontractors");
  if (!perms.canEdit) return { error: "Permission denied" };

  const id = formData.get("id") as string;
  const parsed = parseFormData(formData);
  if (!parsed.success) {
    return { error: "Invalid input", fieldErrors: parsed.error.flatten().fieldErrors };
  }

  // Existence + soft-delete guard: a missing id would throw P2025 (→ 500)
  // and a soft-deleted subcontractor must not be editable from a stale form.
  const existing = await db.subcontractor.findFirst({
    where: { id, deletedAt: null },
    select: { id: true },
  });
  if (!existing) return { error: "Not found" };

  await db.subcontractor.update({ where: { id }, data: toDb(parsed.data) });
  await logActivity("updated", "subcontractor", id, user.id, parsed.data.name);
  revalidateSubcontractor(id);
  return { success: true };
}

export async function deleteSubcontractor(_prev: unknown, formData: FormData) {
  const user = await requireAuth();
  const perms = await resolveModulePerms(user.id, user.role, "subcontractors");
  if (!perms.canDelete) return { error: "Permission denied" };

  const id = formData.get("id") as string;
  const sub = await db.subcontractor.findUnique({ where: { id } });
  if (!sub) return { error: "Not found" };
  if (sub.deletedAt) {
    return { error: "Already in the recovery bin" };
  }

  await db.subcontractor.update({ where: { id }, data: { deletedAt: new Date() } });
  await logActivity("soft-deleted", "subcontractor", id, user.id, sub.name);
  revalidateSubcontractor(id, { deleted: true });
  return { success: true };
}

// ─── Contacts ──────────────────────────────────────────────

const contactSchema = z.object({
  subcontractorId: z.string(),
  name: z.string().min(1, "Name is required"),
  title: z.string().optional(),
  email: z.string().email().optional().or(z.literal("")),
  phone: z.string().optional(),
  isPrimary: z.boolean().optional(),
  notes: z.string().optional(),
});

export async function createSubcontractorContact(_prev: unknown, formData: FormData) {
  const user = await requireAuth();
  const perms = await resolveModulePerms(user.id, user.role, "subcontractors");
  if (!perms.canEdit) return { error: "Permission denied" };

  const parsed = contactSchema.safeParse({
    subcontractorId: formData.get("subcontractorId"),
    name: formData.get("name"),
    title: formData.get("title") || undefined,
    email: formData.get("email") || undefined,
    phone: formData.get("phone") || undefined,
    isPrimary: formData.get("isPrimary") === "true",
    notes: formData.get("notes") || undefined,
  });
  if (!parsed.success) {
    return { error: "Invalid input", fieldErrors: parsed.error.flatten().fieldErrors };
  }

  if (parsed.data.isPrimary) {
    await db.subcontractorContact.updateMany({
      where: { subcontractorId: parsed.data.subcontractorId, isPrimary: true },
      data: { isPrimary: false },
    });
  }

  await db.subcontractorContact.create({ data: parsed.data });
  revalidatePath(`/subcontractors/${parsed.data.subcontractorId}`);
  return { success: true };
}

export async function updateSubcontractorContact(_prev: unknown, formData: FormData) {
  const user = await requireAuth();
  const perms = await resolveModulePerms(user.id, user.role, "subcontractors");
  if (!perms.canEdit) return { error: "Permission denied" };

  const id = formData.get("id") as string;
  const subcontractorId = formData.get("subcontractorId") as string;
  const parsed = contactSchema.safeParse({
    subcontractorId,
    name: formData.get("name"),
    title: formData.get("title") || undefined,
    email: formData.get("email") || undefined,
    phone: formData.get("phone") || undefined,
    isPrimary: formData.get("isPrimary") === "true",
    notes: formData.get("notes") || undefined,
  });
  if (!parsed.success) {
    return { error: "Invalid input", fieldErrors: parsed.error.flatten().fieldErrors };
  }

  if (parsed.data.isPrimary) {
    await db.subcontractorContact.updateMany({
      where: { subcontractorId, isPrimary: true, NOT: { id } },
      data: { isPrimary: false },
    });
  }

  await db.subcontractorContact.update({ where: { id }, data: parsed.data });
  revalidatePath(`/subcontractors/${subcontractorId}`);
  return { success: true };
}

export async function deleteSubcontractorContact(_prev: unknown, formData: FormData) {
  const user = await requireAuth();
  const perms = await resolveModulePerms(user.id, user.role, "subcontractors");
  if (!perms.canEdit) return { error: "Permission denied" };

  const id = formData.get("id") as string;
  const contact = await db.subcontractorContact.findUnique({ where: { id } });
  if (!contact) return { error: "Not found" };

  await db.subcontractorContact.delete({ where: { id } });
  revalidatePath(`/subcontractors/${contact.subcontractorId}`);
  return { success: true };
}

// ─── Project linking ───────────────────────────────────────

const linkSchema = z.object({
  subcontractorId: z.string(),
  projectId: z.string(),
  scope: z.string().optional(),
  role: z.string().optional(),
  status: z.enum(["ACTIVE", "PLANNED", "COMPLETED", "ON_HOLD", "TERMINATED"]).optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  contractValue: z.string().optional(),
  rate: z.string().optional(),
  rateUnit: z.string().optional(),
  notes: z.string().optional(),
});

export async function linkSubcontractorProject(_prev: unknown, formData: FormData) {
  const user = await requireAuth();
  const perms = await resolveModulePerms(user.id, user.role, "subcontractors");
  if (!perms.canEdit) return { error: "Permission denied" };

  const parsed = linkSchema.safeParse({
    subcontractorId: formData.get("subcontractorId"),
    projectId: formData.get("projectId"),
    scope: formData.get("scope") || undefined,
    role: formData.get("role") || undefined,
    status: formData.get("status") || undefined,
    startDate: formData.get("startDate") || undefined,
    endDate: formData.get("endDate") || undefined,
    contractValue: formData.get("contractValue") || undefined,
    rate: formData.get("rate") || undefined,
    rateUnit: formData.get("rateUnit") || undefined,
    notes: formData.get("notes") || undefined,
  });
  if (!parsed.success) {
    return { error: "Invalid input", fieldErrors: parsed.error.flatten().fieldErrors };
  }

  const existing = await db.subcontractorProject.findUnique({
    where: {
      subcontractorId_projectId: {
        subcontractorId: parsed.data.subcontractorId,
        projectId: parsed.data.projectId,
      },
    },
  });
  if (existing) return { error: "Already linked to this project" };

  await db.subcontractorProject.create({
    data: {
      subcontractorId: parsed.data.subcontractorId,
      projectId: parsed.data.projectId,
      scope: parsed.data.scope || null,
      role: parsed.data.role || null,
      status: parsed.data.status,
      startDate: parsed.data.startDate ? new Date(parsed.data.startDate) : null,
      endDate: parsed.data.endDate ? new Date(parsed.data.endDate) : null,
      contractValue: parsed.data.contractValue ? Number(parsed.data.contractValue) : null,
      rate: parsed.data.rate ? Number(parsed.data.rate) : null,
      rateUnit: parsed.data.rateUnit || null,
      notes: parsed.data.notes || null,
    },
  });

  await logActivity(
    "linked",
    "subcontractor",
    parsed.data.subcontractorId,
    user.id,
    `to project`,
    { projectId: parsed.data.projectId },
  );

  revalidateSubcontractor(parsed.data.subcontractorId);
  revalidatePath(`/projects/${parsed.data.projectId}`);
  return { success: true };
}

const linkUpdateSchema = z.object({
  scope: z.string().optional(),
  role: z.string().optional(),
  status: z.enum(["ACTIVE", "PLANNED", "COMPLETED", "ON_HOLD", "TERMINATED"]).optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  contractValue: z.coerce.number().min(0).optional(),
  rate: z.coerce.number().min(0).optional(),
  rateUnit: z.string().optional(),
  notes: z.string().optional(),
});

export async function updateSubcontractorProject(_prev: unknown, formData: FormData) {
  const user = await requireAuth();
  const perms = await resolveModulePerms(user.id, user.role, "subcontractors");
  if (!perms.canEdit) return { error: "Permission denied" };

  const id = formData.get("id") as string;
  const link = await db.subcontractorProject.findUnique({ where: { id } });
  if (!link) return { error: "Not found" };

  // Validate instead of casting — a forged POST used to be able to write
  // arbitrary strings into the status enum and NaN into the numbers.
  const parsed = linkUpdateSchema.safeParse({
    scope: formData.get("scope") || undefined,
    role: formData.get("role") || undefined,
    status: formData.get("status") || undefined,
    startDate: formData.get("startDate") || undefined,
    endDate: formData.get("endDate") || undefined,
    contractValue: formData.get("contractValue") || undefined,
    rate: formData.get("rate") || undefined,
    rateUnit: formData.get("rateUnit") || undefined,
    notes: formData.get("notes") || undefined,
  });
  if (!parsed.success) {
    return { error: "Invalid input", fieldErrors: parsed.error.flatten().fieldErrors };
  }

  await db.subcontractorProject.update({
    where: { id },
    data: {
      scope: parsed.data.scope || null,
      role: parsed.data.role || null,
      status: parsed.data.status ?? link.status,
      startDate: parsed.data.startDate ? new Date(parsed.data.startDate) : null,
      endDate: parsed.data.endDate ? new Date(parsed.data.endDate) : null,
      contractValue: parsed.data.contractValue ?? null,
      rate: parsed.data.rate ?? null,
      rateUnit: parsed.data.rateUnit || null,
      notes: parsed.data.notes || null,
    },
  });

  revalidateSubcontractor(link.subcontractorId);
  revalidatePath(`/projects/${link.projectId}`);
  return { success: true };
}

export async function unlinkSubcontractorProject(_prev: unknown, formData: FormData) {
  const user = await requireAuth();
  const perms = await resolveModulePerms(user.id, user.role, "subcontractors");
  if (!perms.canEdit) return { error: "Permission denied" };

  const id = formData.get("id") as string;
  const link = await db.subcontractorProject.findUnique({ where: { id } });
  if (!link) return { error: "Not found" };

  await db.subcontractorProject.delete({ where: { id } });
  revalidateSubcontractor(link.subcontractorId);
  revalidatePath(`/projects/${link.projectId}`);
  return { success: true };
}
