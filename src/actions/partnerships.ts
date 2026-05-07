"use server";

import { db } from "@/lib/db";
import { requireAuth, resolveModulePerms } from "@/lib/permissions";
import { logActivity } from "@/lib/activity";
import { revalidatePartnership } from "@/lib/revalidate-entity";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { isValidCalendarRange } from "@/lib/dates";
import { nameField } from "@/lib/validation";

const partnershipSchema = z
  .object({
    name: nameField({ label: "Name" }),
    legalName: z.string().optional(),
    type: z.enum([
      "STRATEGIC",
      "REFERRAL",
      "RESELLER",
      "TECHNOLOGY",
      "CHANNEL",
      "JOINT_VENTURE",
      "AFFILIATE",
      "OTHER",
    ]).optional(),
    status: z.enum(["ACTIVE", "PROSPECT", "INACTIVE", "PAUSED", "ARCHIVED"]).optional(),
    tier: z.enum(["PLATINUM", "GOLD", "SILVER", "BRONZE", "STANDARD"]).optional().or(z.literal("")),
    description: z.string().optional(),
    summary: z.string().optional(),
    primaryContactName: z.string().optional(),
    primaryContactEmail: z.string().email().optional().or(z.literal("")),
    primaryContactPhone: z.string().optional(),
    website: z.string().optional(),
    address: z.string().optional(),
    industry: z.string().optional(),
    partnerSinceDate: z.string().optional(),
    agreementSignedAt: z.string().optional(),
    agreementExpiresAt: z.string().optional(),
    autoRenew: z.boolean().optional(),
    revenueShareTerms: z.string().optional(),
    referralFeePercent: z.string().optional(), // collected as percent, stored as bps
    jointMarketing: z.boolean().optional(),
    relationshipOwnerId: z.string().optional(),
    notes: z.string().optional(),
  })
  .refine(
    (d) => isValidCalendarRange(d.agreementSignedAt, d.agreementExpiresAt),
    {
      message: "Agreement expiration must be on or after the signed date",
      path: ["agreementExpiresAt"],
    }
  );

function parseFormData(formData: FormData) {
  return partnershipSchema.safeParse({
    name: formData.get("name"),
    legalName: formData.get("legalName") || undefined,
    type: formData.get("type") || undefined,
    status: formData.get("status") || undefined,
    tier: formData.get("tier") || undefined,
    description: formData.get("description") || undefined,
    summary: formData.get("summary") || undefined,
    primaryContactName: formData.get("primaryContactName") || undefined,
    primaryContactEmail: formData.get("primaryContactEmail") || undefined,
    primaryContactPhone: formData.get("primaryContactPhone") || undefined,
    website: formData.get("website") || undefined,
    address: formData.get("address") || undefined,
    industry: formData.get("industry") || undefined,
    partnerSinceDate: formData.get("partnerSinceDate") || undefined,
    agreementSignedAt: formData.get("agreementSignedAt") || undefined,
    agreementExpiresAt: formData.get("agreementExpiresAt") || undefined,
    autoRenew: formData.get("autoRenew") === "true",
    revenueShareTerms: formData.get("revenueShareTerms") || undefined,
    referralFeePercent: formData.get("referralFeePercent") || undefined,
    jointMarketing: formData.get("jointMarketing") === "true",
    relationshipOwnerId: formData.get("relationshipOwnerId") || undefined,
    notes: formData.get("notes") || undefined,
  });
}

function toDb(parsed: z.infer<typeof partnershipSchema>) {
  // Form collects percent ("20") for readability; we store as basis points
  // so a 1.5% rate doesn't lose precision to a float. 20% → 2000 bps.
  const referralFeeBps = parsed.referralFeePercent
    ? Math.round(Number(parsed.referralFeePercent) * 100)
    : null;

  return {
    name: parsed.name,
    legalName: parsed.legalName || null,
    type: parsed.type,
    status: parsed.status,
    tier: parsed.tier ? parsed.tier : null,
    description: parsed.description || null,
    summary: parsed.summary || null,
    primaryContactName: parsed.primaryContactName || null,
    primaryContactEmail: parsed.primaryContactEmail || null,
    primaryContactPhone: parsed.primaryContactPhone || null,
    website: parsed.website || null,
    address: parsed.address || null,
    industry: parsed.industry || null,
    partnerSinceDate: parsed.partnerSinceDate ? new Date(parsed.partnerSinceDate) : null,
    agreementSignedAt: parsed.agreementSignedAt ? new Date(parsed.agreementSignedAt) : null,
    agreementExpiresAt: parsed.agreementExpiresAt ? new Date(parsed.agreementExpiresAt) : null,
    autoRenew: parsed.autoRenew ?? false,
    revenueShareTerms: parsed.revenueShareTerms || null,
    referralFeeBps,
    jointMarketing: parsed.jointMarketing ?? false,
    relationshipOwnerId: parsed.relationshipOwnerId || null,
    notes: parsed.notes || null,
  };
}

export async function createPartnership(_prev: unknown, formData: FormData) {
  const user = await requireAuth();
  const perms = await resolveModulePerms(user.id, user.role, "partnerships");
  if (!perms.canCreate) return { error: "Permission denied" };

  const parsed = parseFormData(formData);
  if (!parsed.success) {
    return { error: "Invalid input", fieldErrors: parsed.error.flatten().fieldErrors };
  }

  const partnership = await db.partnership.create({ data: toDb(parsed.data) });
  await logActivity("created", "partnership", partnership.id, user.id, partnership.name);
  revalidatePartnership(partnership.id);
  return { success: true };
}

export async function updatePartnership(_prev: unknown, formData: FormData) {
  const user = await requireAuth();
  const perms = await resolveModulePerms(user.id, user.role, "partnerships");
  if (!perms.canEdit) return { error: "Permission denied" };

  const id = formData.get("id") as string;
  const parsed = parseFormData(formData);
  if (!parsed.success) {
    return { error: "Invalid input", fieldErrors: parsed.error.flatten().fieldErrors };
  }

  await db.partnership.update({ where: { id }, data: toDb(parsed.data) });
  await logActivity("updated", "partnership", id, user.id, parsed.data.name);
  revalidatePartnership(id);
  return { success: true };
}

export async function deletePartnership(_prev: unknown, formData: FormData) {
  const user = await requireAuth();
  const perms = await resolveModulePerms(user.id, user.role, "partnerships");
  if (!perms.canDelete) return { error: "Permission denied" };

  const id = formData.get("id") as string;
  const partnership = await db.partnership.findUnique({ where: { id } });
  if (!partnership) return { error: "Not found" };
  if (partnership.deletedAt) {
    return { error: "Already in the recovery bin" };
  }

  await db.partnership.update({ where: { id }, data: { deletedAt: new Date() } });
  await logActivity("soft-deleted", "partnership", id, user.id, partnership.name);
  revalidatePartnership(id, { deleted: true });
  return { success: true };
}

// ─── Contacts ──────────────────────────────────────────────

const contactSchema = z.object({
  partnershipId: z.string(),
  name: z.string().min(1, "Name is required"),
  title: z.string().optional(),
  email: z.string().email().optional().or(z.literal("")),
  phone: z.string().optional(),
  isPrimary: z.boolean().optional(),
  notes: z.string().optional(),
});

export async function createPartnershipContact(_prev: unknown, formData: FormData) {
  const user = await requireAuth();
  const perms = await resolveModulePerms(user.id, user.role, "partnerships");
  if (!perms.canEdit) return { error: "Permission denied" };

  const parsed = contactSchema.safeParse({
    partnershipId: formData.get("partnershipId"),
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
    await db.partnershipContact.updateMany({
      where: { partnershipId: parsed.data.partnershipId, isPrimary: true },
      data: { isPrimary: false },
    });
  }

  await db.partnershipContact.create({ data: parsed.data });
  revalidatePath(`/partnerships/${parsed.data.partnershipId}`);
  return { success: true };
}

export async function updatePartnershipContact(_prev: unknown, formData: FormData) {
  const user = await requireAuth();
  const perms = await resolveModulePerms(user.id, user.role, "partnerships");
  if (!perms.canEdit) return { error: "Permission denied" };

  const id = formData.get("id") as string;
  const partnershipId = formData.get("partnershipId") as string;
  const parsed = contactSchema.safeParse({
    partnershipId,
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
    await db.partnershipContact.updateMany({
      where: { partnershipId, isPrimary: true, NOT: { id } },
      data: { isPrimary: false },
    });
  }

  await db.partnershipContact.update({ where: { id }, data: parsed.data });
  revalidatePath(`/partnerships/${partnershipId}`);
  return { success: true };
}

export async function deletePartnershipContact(_prev: unknown, formData: FormData) {
  const user = await requireAuth();
  const perms = await resolveModulePerms(user.id, user.role, "partnerships");
  if (!perms.canEdit) return { error: "Permission denied" };

  const id = formData.get("id") as string;
  const contact = await db.partnershipContact.findUnique({ where: { id } });
  if (!contact) return { error: "Not found" };

  await db.partnershipContact.delete({ where: { id } });
  revalidatePath(`/partnerships/${contact.partnershipId}`);
  return { success: true };
}

// ─── Project linking ───────────────────────────────────────

const linkSchema = z.object({
  partnershipId: z.string(),
  projectId: z.string(),
  role: z.enum([
    "REFERRER",
    "CO_DELIVERY",
    "JOINT_OWNERSHIP",
    "RESELLER",
    "INTEGRATION",
    "SUBCONTRACTED",
    "OTHER",
  ]).optional(),
  notes: z.string().optional(),
  referralValue: z.string().optional(),
  currency: z.string().optional(),
});

export async function linkPartnershipProject(_prev: unknown, formData: FormData) {
  const user = await requireAuth();
  const perms = await resolveModulePerms(user.id, user.role, "partnerships");
  if (!perms.canEdit) return { error: "Permission denied" };

  const parsed = linkSchema.safeParse({
    partnershipId: formData.get("partnershipId"),
    projectId: formData.get("projectId"),
    role: formData.get("role") || undefined,
    notes: formData.get("notes") || undefined,
    referralValue: formData.get("referralValue") || undefined,
    currency: formData.get("currency") || undefined,
  });
  if (!parsed.success) {
    return { error: "Invalid input", fieldErrors: parsed.error.flatten().fieldErrors };
  }

  const existing = await db.partnershipProject.findUnique({
    where: {
      partnershipId_projectId: {
        partnershipId: parsed.data.partnershipId,
        projectId: parsed.data.projectId,
      },
    },
  });
  if (existing) return { error: "Already linked to this project" };

  await db.partnershipProject.create({
    data: {
      partnershipId: parsed.data.partnershipId,
      projectId: parsed.data.projectId,
      role: parsed.data.role || "OTHER",
      notes: parsed.data.notes || null,
      referralValue: parsed.data.referralValue ? Number(parsed.data.referralValue) : null,
      currency: parsed.data.currency || "USD",
    },
  });

  await logActivity(
    "linked",
    "partnership",
    parsed.data.partnershipId,
    user.id,
    "to project",
    { projectId: parsed.data.projectId },
  );

  revalidatePartnership(parsed.data.partnershipId);
  revalidatePath(`/projects/${parsed.data.projectId}`);
  return { success: true };
}

export async function updatePartnershipProject(_prev: unknown, formData: FormData) {
  const user = await requireAuth();
  const perms = await resolveModulePerms(user.id, user.role, "partnerships");
  if (!perms.canEdit) return { error: "Permission denied" };

  const id = formData.get("id") as string;
  const link = await db.partnershipProject.findUnique({ where: { id } });
  if (!link) return { error: "Not found" };

  await db.partnershipProject.update({
    where: { id },
    data: {
      role: (formData.get("role") as
        | "REFERRER"
        | "CO_DELIVERY"
        | "JOINT_OWNERSHIP"
        | "RESELLER"
        | "INTEGRATION"
        | "SUBCONTRACTED"
        | "OTHER") || link.role,
      notes: (formData.get("notes") as string) || null,
      referralValue: formData.get("referralValue")
        ? Number(formData.get("referralValue"))
        : null,
      currency: (formData.get("currency") as string) || "USD",
    },
  });

  revalidatePartnership(link.partnershipId);
  revalidatePath(`/projects/${link.projectId}`);
  return { success: true };
}

export async function unlinkPartnershipProject(_prev: unknown, formData: FormData) {
  const user = await requireAuth();
  const perms = await resolveModulePerms(user.id, user.role, "partnerships");
  if (!perms.canEdit) return { error: "Permission denied" };

  const id = formData.get("id") as string;
  const link = await db.partnershipProject.findUnique({ where: { id } });
  if (!link) return { error: "Not found" };

  await db.partnershipProject.delete({ where: { id } });
  revalidatePartnership(link.partnershipId);
  revalidatePath(`/projects/${link.projectId}`);
  return { success: true };
}
