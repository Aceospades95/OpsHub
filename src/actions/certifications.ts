"use server";

import { db } from "@/lib/db";
import { requireAuth } from "@/lib/permissions";
import { assertManageEntity } from "@/lib/entity-authz";
import { logActivity } from "@/lib/activity";
import { deriveActivityScope } from "@/lib/activity-scope";
import { revalidatePath } from "next/cache";
import { revalidateCertification } from "@/lib/revalidate-entity";
import { isValidCalendarRange } from "@/lib/dates";
import { z } from "zod";

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

/**
 * Validated subset of the cert form. These fields used to be cast
 * straight from the raw form strings (`as CertificationStatus` etc.) so
 * a forged POST could write arbitrary enum values, NaN numbers, or junk
 * email/url strings. Values must match the Prisma enums in
 * prisma/schema.prisma exactly.
 */
const certFieldsSchema = z.object({
  status: z.enum(["ACTIVE", "EXPIRING_SOON", "EXPIRED", "PENDING", "SUSPENDED", "REVOKED"]),
  type: z.enum(["INDUSTRY", "COMPLIANCE", "SAFETY", "PROFESSIONAL", "QUALITY", "SECURITY", "ENVIRONMENTAL", "VENDOR", "OTHER"]),
  engagementType: z.enum(["SUBSCRIPTION", "CERTIFICATION"]),
  jurisdictionLevel: z.enum(["FEDERAL", "STATE", "COUNTY", "CITY", "AGENCY", "PRIVATE", "OTHER"]),
  renewalLeadDays: z.coerce.number().int().min(0).max(3650),
  renewalCost: z.coerce.number().min(0).max(1_000_000_000).nullable(),
  agencyContactEmail: z.string().email("Invalid email address").nullable(),
  agencyWebsiteUrl: z.string().url("Invalid URL (include https://)").nullable(),
});

function extractCertData(formData: FormData) {
  const parsed = certFieldsSchema.safeParse({
    status: str(formData, "status") || "PENDING",
    type: str(formData, "type") || "OTHER",
    engagementType: str(formData, "engagementType") || "CERTIFICATION",
    jurisdictionLevel: str(formData, "jurisdictionLevel") || "OTHER",
    renewalLeadDays: str(formData, "renewalLeadDays") ?? 90,
    renewalCost: str(formData, "renewalCost"),
    agencyContactEmail: str(formData, "agencyContactEmail"),
    agencyWebsiteUrl: str(formData, "agencyWebsiteUrl"),
  });
  if (!parsed.success) {
    return {
      error: "Invalid input" as const,
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }

  const reminderOffsetsDays = parseReminderOffsets(str(formData, "reminderOffsetsDays"));
  return {
    data: {
      description: str(formData, "description"),
      plainEnglishSummary: str(formData, "plainEnglishSummary"),
      certNumber: str(formData, "certNumber"),
      jurisdictionName: str(formData, "jurisdictionName"),
      issuingBody: str(formData, "issuingBody"),
      agencyContactName: str(formData, "agencyContactName"),
      agencyContactPhone: str(formData, "agencyContactPhone"),
      issuedDate: parseDate(formData, "issuedDate"),
      submittedDate: parseDate(formData, "submittedDate"),
      expirationDate: parseDate(formData, "expirationDate"),
      renewalDate: parseDate(formData, "renewalDate"),
      ...(reminderOffsetsDays ? { reminderOffsetsDays } : {}),
      autoRenew: formData.get("autoRenew") === "true" || formData.get("autoRenew") === "on",
      currency: str(formData, "currency") || "USD",
      renewalRequirements: str(formData, "renewalRequirements"),
      renewalNotes: str(formData, "renewalNotes"),
      documentUrl: str(formData, "documentUrl"),
      completedCertUrl: str(formData, "completedCertUrl"),
      clientId: str(formData, "clientId"),
      assigneeId: str(formData, "assigneeId"),
      pointOfContactId: str(formData, "pointOfContactId"),
      ...parsed.data,
    },
  };
}

// ─── CRUD ──────────────────────────────────────────────
//
// The certifications module is `adminOnly` in src/lib/modules.ts (the
// sidebar hides it from non-admins) but server actions are reachable
// by anyone with a session via direct POST. We re-assert the gate
// here so a logged-in GUEST can't mutate compliance data.

/**
 * Restricts cert mutations to ADMIN. MANAGERs can sign off via
 * `signOffCertification` but should not be creating/editing/deleting
 * cert rows themselves — that's compliance metadata.
 */
function requireCertAdmin(role: string): { error: string } | null {
  if (role !== "ADMIN") {
    return { error: "Admin access required to manage certifications" };
  }
  return null;
}

/**
 * Validate the cert's calendar-date pairs. A cert can't expire before
 * it was issued, and renewal can't be earlier than issuance either.
 * Returns an `{ error }` shape that mirrors the rest of the action's
 * return contract; null when the dates are coherent.
 */
function validateCertDates(
  formData: FormData
): { error: string; fieldErrors?: Record<string, string[]> } | null {
  const issuedDate = (formData.get("issuedDate") as string | null) || null;
  const expirationDate =
    (formData.get("expirationDate") as string | null) || null;
  const renewalDate = (formData.get("renewalDate") as string | null) || null;

  if (!isValidCalendarRange(issuedDate, expirationDate)) {
    return {
      error: "Expiration date must be on or after the issued date",
      fieldErrors: {
        expirationDate: ["Expiration date must be on or after the issued date"],
      },
    };
  }
  if (!isValidCalendarRange(issuedDate, renewalDate)) {
    return {
      error: "Renewal date must be on or after the issued date",
      fieldErrors: {
        renewalDate: ["Renewal date must be on or after the issued date"],
      },
    };
  }
  return null;
}

export async function createCertification(_prev: unknown, formData: FormData) {
  const user = await requireAuth();
  const gate = requireCertAdmin(user.role);
  if (gate) return gate;

  const name = (formData.get("name") as string | null)?.trim();
  if (!name) return { error: "Name is required" };

  const dateError = validateCertDates(formData);
  if (dateError) return dateError;

  const extracted = extractCertData(formData);
  if ("error" in extracted) return { error: extracted.error, fieldErrors: extracted.fieldErrors };

  const cert = await db.certification.create({
    data: { name, ...extracted.data },
  });

  await logActivity("created", "certification", cert.id, user.id, cert.name, {
    clientId: cert.clientId,
  });
  revalidateCertification(cert.id, {
    clientId: cert.clientId,
    assigneeId: cert.assigneeId,
  });
  return { success: true, id: cert.id };
}

export async function updateCertification(_prev: unknown, formData: FormData) {
  const user = await requireAuth();
  const gate = requireCertAdmin(user.role);
  if (gate) return gate;

  const id = formData.get("id") as string;
  if (!id) return { error: "ID required" };

  const name = (formData.get("name") as string | null)?.trim();
  if (!name) return { error: "Name is required" };

  const dateError = validateCertDates(formData);
  if (dateError) return dateError;

  const extracted = extractCertData(formData);
  if ("error" in extracted) return { error: extracted.error, fieldErrors: extracted.fieldErrors };

  // Existence + soft-delete guard: a missing id would throw P2025 (→ 500)
  // and a soft-deleted cert must not be editable from a stale form.
  const existing = await db.certification.findFirst({
    where: { id, deletedAt: null },
    select: { id: true, clientId: true, assigneeId: true },
  });
  if (!existing) return { error: "Not found" };

  // Entity-scope write gate. Trivially true while requireCertAdmin
  // restricts mutations to ADMIN, but kept as defense-in-depth should
  // that gate ever loosen.
  const denied = await assertManageEntity(user.id, user.role, "certification", id);
  if (denied) return { error: denied.error };

  const updated = await db.certification.update({
    where: { id },
    data: { name, ...extracted.data },
    select: { clientId: true, assigneeId: true },
  });

  await logActivity("updated", "certification", id, user.id, name, {
    clientId: updated.clientId,
  });
  revalidateCertification(id, {
    clientId: updated.clientId,
    previousClientId: existing.clientId,
    assigneeId: updated.assigneeId,
    previousAssigneeId: existing.assigneeId,
  });
  return { success: true };
}

export async function deleteCertification(_prev: unknown, formData: FormData) {
  const user = await requireAuth();
  const gate = requireCertAdmin(user.role);
  if (gate) return gate;

  const id = formData.get("id") as string;
  if (!id) return { error: "ID required" };

  const cert = await db.certification.findUnique({ where: { id }, select: { name: true, clientId: true, deletedAt: true } });
  if (!cert) return { error: "Not found" };
  if (cert.deletedAt) {
    return { error: "Already in the recovery bin" };
  }

  const denied = await assertManageEntity(user.id, user.role, "certification", id);
  if (denied) return { error: denied.error };

  await db.certification.update({ where: { id }, data: { deletedAt: new Date() } });

  await logActivity("soft-deleted", "certification", id, user.id, cert.name || "", {
    clientId: cert.clientId ?? null,
  });
  revalidateCertification(id, { clientId: cert.clientId ?? null, deleted: true });
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

  const cert = await db.certification.findFirst({
    where: { id, deletedAt: null },
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

  // Entity-scope write gate: MANAGER passes the role check above but
  // must still be assigned to (or granted) this specific cert.
  const denied = await assertManageEntity(user.id, user.role, "certification", id);
  if (denied) return { error: denied.error };

  await db.$transaction([
    db.certification.update({
      where: { id },
      data: {
        signedOffAt: now,
        signedOffById: user.id,
        signOffNotes: notes,
        // Reset fired reminders so the next cycle starts fresh
        firedReminderOffsets: [],
        // The renewal cycle is complete — reminders re-arm.
        renewalSubmittedAt: null,
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
  revalidateCertification(id);
  return { success: true };
}

export async function revokeSignOff(_prev: unknown, formData: FormData) {
  const user = await requireAuth();
  if (user.role !== "ADMIN") {
    return { error: "Only admins can revoke a sign-off" };
  }

  const id = formData.get("id") as string;
  if (!id) return { error: "ID required" };

  const cert = await db.certification.findFirst({
    where: { id, deletedAt: null },
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
  revalidateCertification(id);
  return { success: true };
}

// ─── Renewal Checklist ─────────────────────────────────

async function canModifyChecklist(
  certId: string,
  user: { id: string; role: string }
): Promise<boolean> {
  if (["ADMIN", "MANAGER", "DEVELOPER"].includes(user.role)) return true;
  // Contributors can toggle if they're the assignee or POC
  const cert = await db.certification.findFirst({
    where: { id: certId, deletedAt: null },
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

  // Verify the parent cert exists and isn't soft-deleted before
  // attaching items to it (canModifyChecklist skips the lookup for
  // admin/manager/developer roles).
  const parent = await db.certification.findFirst({
    where: { id: certId, deletedAt: null },
    select: { id: true },
  });
  if (!parent) return { error: "Not found" };

  if (!(await canModifyChecklist(certId, user))) return { error: "Permission denied" };

  const denied = await assertManageEntity(user.id, user.role, "certification", certId);
  if (denied) return { error: denied.error };

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

  const denied = await assertManageEntity(user.id, user.role, "certification", item.certificationId);
  if (denied) return { error: denied.error };

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

  const denied = await assertManageEntity(user.id, user.role, "certification", item.certificationId);
  if (denied) return { error: denied.error };

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

// ─── Renewal submitted ─────────────────────────────────────────
//
// "We applied for the renewal, now we wait." While set, the expiry
// reminder job skips this cert and list views show "Renewal Submitted"
// instead of expiring/expired alarms. Cleared automatically on sign-off
// (new cycle) or manually from the detail page.

export async function setRenewalSubmitted(_prev: unknown, formData: FormData) {
  const user = await requireAuth();
  if (user.role !== "ADMIN" && user.role !== "MANAGER") {
    return { error: "Only admins and managers can update renewal status" };
  }

  const id = formData.get("id") as string;
  if (!id) return { error: "ID required" };
  const submitted = formData.get("submitted") === "true";

  const cert = await db.certification.findFirst({
    where: { id, deletedAt: null },
    select: { id: true, name: true, clientId: true },
  });
  if (!cert) return { error: "Not found" };

  const denied = await assertManageEntity(user.id, user.role, "certification", id);
  if (denied) return { error: denied.error };

  await db.certification.update({
    where: { id },
    data: { renewalSubmittedAt: submitted ? new Date() : null },
  });

  await logActivity(
    submitted ? "renewal-submitted" : "renewal-submission-cleared",
    "certification",
    id,
    user.id,
    cert.name,
    { clientId: cert.clientId }
  );
  revalidateCertification(id, { clientId: cert.clientId });
  return { success: true };
}
