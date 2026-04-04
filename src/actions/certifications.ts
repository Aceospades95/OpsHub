"use server";

import { db } from "@/lib/db";
import { requireAuth } from "@/lib/permissions";
import { logActivity } from "@/lib/activity";
import { revalidatePath } from "next/cache";
import type { CertificationStatus, CertificationType } from "@prisma/client";

export async function createCertification(_prev: unknown, formData: FormData) {
  const user = await requireAuth();

  const name = formData.get("name") as string;
  if (!name?.trim()) return { error: "Name is required" };

  const cert = await db.certification.create({
    data: {
      name: name.trim(),
      description: (formData.get("description") as string) || null,
      certNumber: (formData.get("certNumber") as string) || null,
      status: ((formData.get("status") as string) || "PENDING") as CertificationStatus,
      type: ((formData.get("type") as string) || "OTHER") as CertificationType,
      issuingBody: (formData.get("issuingBody") as string) || null,
      issuedDate: formData.get("issuedDate") ? new Date(formData.get("issuedDate") as string) : null,
      expirationDate: formData.get("expirationDate") ? new Date(formData.get("expirationDate") as string) : null,
      renewalDate: formData.get("renewalDate") ? new Date(formData.get("renewalDate") as string) : null,
      renewalLeadDays: formData.get("renewalLeadDays") ? Number(formData.get("renewalLeadDays")) : 90,
      autoRenew: formData.get("autoRenew") === "true",
      renewalCost: formData.get("renewalCost") ? Number(formData.get("renewalCost")) : null,
      currency: (formData.get("currency") as string) || "USD",
      renewalRequirements: (formData.get("renewalRequirements") as string) || null,
      renewalNotes: (formData.get("renewalNotes") as string) || null,
      documentUrl: (formData.get("documentUrl") as string) || null,
      clientId: (formData.get("clientId") as string) || null,
      assigneeId: (formData.get("assigneeId") as string) || null,
    },
  });

  await logActivity("created", "certification", cert.id, user.id, cert.name);
  revalidatePath("/certifications");
  return { success: true, id: cert.id };
}

export async function updateCertification(_prev: unknown, formData: FormData) {
  const user = await requireAuth();
  const id = formData.get("id") as string;
  if (!id) return { error: "ID required" };

  const name = formData.get("name") as string;
  if (!name?.trim()) return { error: "Name is required" };

  await db.certification.update({
    where: { id },
    data: {
      name: name.trim(),
      description: (formData.get("description") as string) || null,
      certNumber: (formData.get("certNumber") as string) || null,
      status: ((formData.get("status") as string) || undefined) as CertificationStatus | undefined,
      type: ((formData.get("type") as string) || undefined) as CertificationType | undefined,
      issuingBody: (formData.get("issuingBody") as string) || null,
      issuedDate: formData.get("issuedDate") ? new Date(formData.get("issuedDate") as string) : null,
      expirationDate: formData.get("expirationDate") ? new Date(formData.get("expirationDate") as string) : null,
      renewalDate: formData.get("renewalDate") ? new Date(formData.get("renewalDate") as string) : null,
      renewalLeadDays: formData.get("renewalLeadDays") ? Number(formData.get("renewalLeadDays")) : 90,
      autoRenew: formData.get("autoRenew") === "true",
      renewalCost: formData.get("renewalCost") ? Number(formData.get("renewalCost")) : null,
      currency: (formData.get("currency") as string) || "USD",
      renewalRequirements: (formData.get("renewalRequirements") as string) || null,
      renewalNotes: (formData.get("renewalNotes") as string) || null,
      documentUrl: (formData.get("documentUrl") as string) || null,
      clientId: (formData.get("clientId") as string) || null,
      assigneeId: (formData.get("assigneeId") as string) || null,
    },
  });

  await logActivity("updated", "certification", id, user.id, name);
  revalidatePath("/certifications");
  revalidatePath(`/certifications/${id}`);
  return { success: true };
}

export async function deleteCertification(_prev: unknown, formData: FormData) {
  const user = await requireAuth();
  const id = formData.get("id") as string;
  if (!id) return { error: "ID required" };

  const cert = await db.certification.findUnique({ where: { id }, select: { name: true } });
  await db.certification.delete({ where: { id } });

  await logActivity("deleted", "certification", id, user.id, cert?.name || "");
  revalidatePath("/certifications");
  return { success: true };
}
