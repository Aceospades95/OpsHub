"use server";

import { db } from "@/lib/db";
import { requireAuth } from "@/lib/permissions";
import { logActivity } from "@/lib/activity";
import { deriveActivityScope } from "@/lib/activity-scope";
import { revalidatePath } from "next/cache";
import type {
  CertificationStatus,
  CertificationType,
  JurisdictionLevel,
  CertEngagementType,
} from "@prisma/client";

// ─── Helpers ───────────────────────────────────────────

function str(fd: FormData, key: string): string | null {
  const v = fd.get(key);
  if (typeof v !== "string") return null;
  const trimmed = v.trim();
  return trimmed === "" ? null : trimmed;
}

function parseDate(fd: FormData, key: string): Date | null {
  const v = str(fd, key);
  if (!v) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

function parseReminderOffsets(raw: string | null): number[] | undefined {
  if (raw === null) return undefined;
  // Accept comma- or pipe-separated lists
  const parts = raw.split(/[,|]/).map((p) => parseInt(p.trim(), 10));
  const clean = parts.filter((n) => Number.isFinite(n) && n > 0);
  if (clean.length === 0) return undefined;
  // Sort descending so we fire the furthest-out reminder first
  return Array.from(new Set(clean)).sort((a, b) => b - a);
}

function extractCertData(formData: FormData) {
  const reminderOffsetsDays = parseReminderOffsets(str(formData, "reminderOffsetsDays"));
  return {
    description: str(formData, "description"),
    plainEnglishSummary: str(formData, "plainEnglishSummary"),
    certNumber: str(formData, "certNumber"),
    status: (str(formData, "status") || "PENDING") as CertificationStatus,
    type: (str(formData, "type") || "OTHER") as CertificationType,
    engagementType: (str(formData, "engagementType") || "CERTIFICATION") as CertEngagementType,
    jurisdictionLevel: (str(formData, "jurisdictionLevel") || "OTHER") as JurisdictionLevel,
    jurisdictionName: str(formData, "jurisdictionName"),
    issuingBody: str(formData, "issuingBody"),
    agencyWebsiteUrl: str(formData, "agencyWebsiteUrl"),
    agencyContactName: str(formData, "agencyContactName"),
    agencyContactEmail: str(formData, "agencyContactEmail"),
    agencyContactPhone: str(formData, "agencyContactPhone"),
    issuedDate: parseDate(formData, "issuedDate"),
    submittedDate: parseDate(formData, "submittedDate"),
    expirationDate: parseDate(formData, "expirationDate"),
    renewalDate: parseDate(formData, "renewalDate"),
    renewalLeadDays: str(formData, "renewalLeadDays") ? Number(formData.get("renewalLeadDays")) : 90,
    ...(reminderOffsetsDays ? { reminderOffsetsDays } : {}),
    autoRenew: formData.get("autoRenew") === "true" || formData.get("autoRenew") === "on",
    renewalCost: str(formData, "renewalCost") ? Number(formData.get("renewalCost")) : null,
    currency: str(formData, "currency") || "USD",
    renewalRequirements: str(formData, "renewalRequirements"),
    renewalNotes: str(formData, "renewalNotes"),
    documentUrl: str(formData, "documentUrl"),
    completedCertUrl: str(formData, "completedCertUrl"),
    clientId: str(formData, "clientId"),
    assigneeId: str(formData, "assigneeId"),
    pointOfContactId: str(formData, "pointOfContactId"),
  };
}

// ─── CRUD ──────────────────────────────────────────────

export async function createCertification(_prev: unknown, formData: FormData) {
  const user = await requireAuth();

  const name = (formData.get("name") as string | null)?.trim();
  if (!name) return { error: "Name is required" };

  const cert = await db.certification.create({
    data: { name, ...extractCertData(formData) },
  });

  await logActivity("created", "certification", cert.id, user.id, cert.name, {
    clientId: cert.clientId,
  });
  revalidatePath("/certifications");
  return { success: true, id: cert.id };
}

export async function updateCertification(_prev: unknown, formData: FormData) {
  const user = await requireAuth();
  const id = formData.get("id") as string;
  if (!id) return { error: "ID required" };

  const name = (formData.get("name") as string | null)?.trim();
  if (!name) return { error: "Name is required" };

  const updated = await db.certification.update({
    where: { id },
    data: { name, ...extractCertData(formData) },
    select: { clientId: true },
  });

  await logActivity("updated", "certification", id, user.id, name, {
    clientId: updated.clientId,
  });
  revalidatePath("/certifications");
  revalidatePath(`/certifications/${id}`);
  return { success: true };
}

export async function deleteCertification(_prev: unknown, formData: FormData) {
  const user = await requireAuth();
  const id = formData.get("id") as string;
  if (!id) return { error: "ID required" };

  const cert = await db.certification.findUnique({ where: { id }, select: { name: true, clientId: true } });
  await db.certification.delete({ where: { id } });

  await logActivity("deleted", "certification", id, user.id, cert?.name || "", {
    clientId: cert?.clientId ?? null,
  });
  revalidatePath("/certifications");
  return { success: true };
}

// ─── Sign-Off ──────────────────────────────────────────

export async function signOffCertification(_prev: unknown, formData: FormData) {
  const user = await requireAuth();
  if (user.role !== "ADMIN" && user.role !== "MANAGER") {
    return { error: "Only admins and managers can sign off certifications" };
  }

  const id = formData.get("id") as string;
  if (!id) return { error: "ID required" };

  const notes = str(formData, "notes");
  const now = new Date();

  const cert = await db.certification.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      issuedDate: true,
      expirationDate: true,
      renewalCost: true,
      currency: true,
      clientId: true,
    },
  });
  if (!cert) return { error: "Not found" };

  await db.$transaction([
    db.certification.update({
      where: { id },
      data: {
        signedOffAt: now,
        signedOffById: user.id,
        signOffNotes: notes,
        // Reset fired reminders so the next cycle starts fresh
        firedReminderOffsets: [],
      },
    }),
    db.certificationRenewalHistory.create({
      data: {
        certificationId: id,
        cycleStart: cert.issuedDate,
        cycleEnd: cert.expirationDate,
        issuedDate: cert.issuedDate,
        expiredDate: cert.expirationDate,
        signedOffById: user.id,
        signedOffAt: now,
        cost: cert.renewalCost,
        currency: cert.currency ?? "USD",
        notes,
      },
    }),
  ]);

  await logActivity(
    "signed-off",
    "certification",
    id,
    user.id,
    notes ? `${cert.name}: ${notes}` : cert.name,
    { clientId: cert.clientId }
  );
  revalidatePath(`/certifications/${id}`);
  revalidatePath("/certifications");
  return { success: true };
}

export async function revokeSignOff(_prev: unknown, formData: FormData) {
  const user = await requireAuth();
  if (user.role !== "ADMIN") {
    return { error: "Only admins can revoke a sign-off" };
  }

  const id = formData.get("id") as string;
  if (!id) return { error: "ID required" };

  const cert = await db.certification.findUnique({
    where: { id },
    select: { name: true, signedOffAt: true, clientId: true },
  });
  if (!cert) return { error: "Not found" };
  if (!cert.signedOffAt) return { error: "Not currently signed off" };

  await db.certification.update({
    where: { id },
    data: { signedOffAt: null, signedOffById: null, signOffNotes: null },
  });

  await logActivity("sign-off-revoked", "certification", id, user.id, cert.name, {
    clientId: cert.clientId,
  });
  revalidatePath(`/certifications/${id}`);
  revalidatePath("/certifications");
  return { success: true };
}

// ─── Renewal Checklist ─────────────────────────────────

async function canModifyChecklist(
  certId: string,
  user: { id: string; role: string }
): Promise<boolean> {
  if (["ADMIN", "MANAGER", "DEVELOPER"].includes(user.role)) return true;
  // Contributors can toggle if they're the assignee or POC
  const cert = await db.certification.findUnique({
    where: { id: certId },
    select: { assigneeId: true, pointOfContactId: true },
  });
  if (!cert) return false;
  return cert.assigneeId === user.id || cert.pointOfContactId === user.id;
}

export async function addChecklistItem(_prev: unknown, formData: FormData) {
  const user = await requireAuth();
  const certId = formData.get("certId") as string;
  const label = (formData.get("label") as string | null)?.trim();
  if (!certId || !label) return { error: "Missing fields" };

  if (!(await canModifyChecklist(certId, user))) return { error: "Permission denied" };

  const required = formData.get("required") === "true" || formData.get("required") === "on";

  const maxOrder = await db.certificationRenewalChecklistItem.aggregate({
    where: { certificationId: certId },
    _max: { sortOrder: true },
  });

  await db.certificationRenewalChecklistItem.create({
    data: {
      certificationId: certId,
      label,
      required,
      sortOrder: (maxOrder._max.sortOrder ?? -1) + 1,
    },
  });

  await logActivity("checklist-added", "certification", certId, user.id, label, await deriveActivityScope("certification", certId));
  revalidatePath(`/certifications/${certId}`);
  return { success: true };
}

export async function toggleChecklistItem(_prev: unknown, formData: FormData) {
  const user = await requireAuth();
  const itemId = formData.get("itemId") as string;
  if (!itemId) return { error: "ID required" };

  const item = await db.certificationRenewalChecklistItem.findUnique({
    where: { id: itemId },
    select: { id: true, certificationId: true, completed: true, label: true },
  });
  if (!item) return { error: "Not found" };

  if (!(await canModifyChecklist(item.certificationId, user))) {
    return { error: "Permission denied" };
  }

  const nextCompleted = !item.completed;
  await db.certificationRenewalChecklistItem.update({
    where: { id: itemId },
    data: {
      completed: nextCompleted,
      completedAt: nextCompleted ? new Date() : null,
      completedById: nextCompleted ? user.id : null,
    },
  });

  await logActivity(
    "checklist-toggled",
    "certification",
    item.certificationId,
    user.id,
    `${item.label}: ${nextCompleted ? "done" : "reopened"}`,
    await deriveActivityScope("certification", item.certificationId)
  );
  revalidatePath(`/certifications/${item.certificationId}`);
  return { success: true };
}

export async function removeChecklistItem(_prev: unknown, formData: FormData) {
  const user = await requireAuth();
  const itemId = formData.get("itemId") as string;
  if (!itemId) return { error: "ID required" };

  const item = await db.certificationRenewalChecklistItem.findUnique({
    where: { id: itemId },
    select: { certificationId: true, label: true },
  });
  if (!item) return { error: "Not found" };

  if (!(await canModifyChecklist(item.certificationId, user))) {
    return { error: "Permission denied" };
  }

  // Derive scope BEFORE the delete so the cert lookup still works.
  const scope = await deriveActivityScope("certification", item.certificationId);
  await db.certificationRenewalChecklistItem.delete({ where: { id: itemId } });
  await logActivity(
    "checklist-removed",
    "certification",
    item.certificationId,
    user.id,
    item.label,
    scope
  );
  revalidatePath(`/certifications/${item.certificationId}`);
  return { success: true };
}
