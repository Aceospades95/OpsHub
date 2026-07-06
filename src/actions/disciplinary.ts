"use server";

import { db } from "@/lib/db";
import { requireAuth } from "@/lib/permissions";
import { logActivity } from "@/lib/activity";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { Role } from "@prisma/client";
import { DISCIPLINARY_ACTION_LABELS, isHrRole } from "@/lib/disciplinary";

/**
 * Disciplinary action reports — HR incident documentation, replacing the
 * Google Spreadsheet template. SENSITIVE: every path (including reads on
 * the profile page) is restricted to ADMIN and MANAGER; reports are
 * never visible to the field tier or to the employee's own account
 * through the app. That last clause includes HR roles themselves — the
 * SUBJECT of a report can never read or touch it, even as ADMIN, so a
 * manager can't rewrite or self-acknowledge a warning issued about them.
 * The exported PDF is the artifact that gets handed to the employee.
 *
 * Activity-log entries store only the action-type label (never the
 * employee name or incident text) and are additionally filtered from
 * non-HR viewers via activityVisibilityWhere() in lib/activity.
 */

const ACTION_TYPES = [
  "VERBAL_WARNING",
  "WRITTEN_WARNING",
  "FINAL_WARNING",
  "SUSPENSION",
  "TERMINATION",
  "OTHER",
] as const;

function requireHrRole(role: Role): { error: string } | null {
  if (!isHrRole(role)) {
    return { error: "Only admins and managers can manage disciplinary reports" };
  }
  return null;
}

/** The subject of a report can never act on it — not even as ADMIN. */
function requireNotSubject(
  viewerId: string,
  employeeId: string
): { error: string } | null {
  if (viewerId === employeeId) {
    return { error: "You can't manage a disciplinary report about yourself" };
  }
  return null;
}

const reportSchema = z.object({
  employeeId: z.string().min(1),
  actionType: z.enum(ACTION_TYPES),
  incidentDate: z.string().min(1, "Incident date is required"),
  description: z.string().trim().min(1, "Describe what happened").max(10000),
  actionTaken: z.string().max(10000).optional(),
  improvementPlan: z.string().max(10000).optional(),
  witnesses: z.string().max(500).optional(),
  followUpDate: z.string().optional(),
  notes: z.string().max(10000).optional(),
});

function parseReportForm(formData: FormData) {
  return reportSchema.safeParse({
    employeeId: formData.get("employeeId"),
    actionType: formData.get("actionType") || "WRITTEN_WARNING",
    incidentDate: formData.get("incidentDate"),
    description: formData.get("description"),
    actionTaken: (formData.get("actionTaken") as string) || undefined,
    improvementPlan: (formData.get("improvementPlan") as string) || undefined,
    witnesses: (formData.get("witnesses") as string) || undefined,
    followUpDate: (formData.get("followUpDate") as string) || undefined,
    notes: (formData.get("notes") as string) || undefined,
  });
}

export async function createDisciplinaryReport(_prev: unknown, formData: FormData) {
  const user = await requireAuth();
  const gate = requireHrRole(user.role);
  if (gate) return gate;

  const parsed = parseReportForm(formData);
  if (!parsed.success) {
    return { error: parsed.error.errors[0].message, fieldErrors: parsed.error.flatten().fieldErrors };
  }
  const data = parsed.data;

  const selfGate = requireNotSubject(user.id, data.employeeId);
  if (selfGate) return selfGate;

  const employee = await db.user.findUnique({
    where: { id: data.employeeId },
    select: { id: true, name: true },
  });
  if (!employee) return { error: "Employee not found" };

  const report = await db.disciplinaryReport.create({
    data: {
      employeeId: data.employeeId,
      issuedById: user.id,
      actionType: data.actionType,
      incidentDate: new Date(data.incidentDate),
      description: data.description,
      actionTaken: data.actionTaken?.trim() || null,
      improvementPlan: data.improvementPlan?.trim() || null,
      witnesses: data.witnesses?.trim() || null,
      followUpDate: data.followUpDate ? new Date(data.followUpDate) : null,
      notes: data.notes?.trim() || null,
    },
  });

  // Action-type label only — no employee name, no incident text. The
  // activity feed is broader than the HR audience even with the
  // entity-type filter as backstop.
  await logActivity(
    "created",
    "disciplinary-report",
    report.id,
    user.id,
    DISCIPLINARY_ACTION_LABELS[data.actionType]
  );
  revalidatePath(`/team/${data.employeeId}`);
  return { success: true };
}

export async function updateDisciplinaryReport(_prev: unknown, formData: FormData) {
  const user = await requireAuth();
  const gate = requireHrRole(user.role);
  if (gate) return gate;

  const id = formData.get("id") as string;
  if (!id) return { error: "ID required" };

  const parsed = parseReportForm(formData);
  if (!parsed.success) {
    return { error: parsed.error.errors[0].message, fieldErrors: parsed.error.flatten().fieldErrors };
  }
  const data = parsed.data;

  const existing = await db.disciplinaryReport.findFirst({
    where: { id, deletedAt: null },
    select: { id: true, employeeId: true },
  });
  if (!existing) return { error: "Not found" };
  const selfGate = requireNotSubject(user.id, existing.employeeId);
  if (selfGate) return selfGate;

  await db.disciplinaryReport.update({
    where: { id },
    data: {
      actionType: data.actionType,
      incidentDate: new Date(data.incidentDate),
      description: data.description,
      actionTaken: data.actionTaken?.trim() || null,
      improvementPlan: data.improvementPlan?.trim() || null,
      witnesses: data.witnesses?.trim() || null,
      followUpDate: data.followUpDate ? new Date(data.followUpDate) : null,
      notes: data.notes?.trim() || null,
    },
  });

  await logActivity("updated", "disciplinary-report", id, user.id, DISCIPLINARY_ACTION_LABELS[data.actionType]);
  revalidatePath(`/team/${existing.employeeId}`);
  return { success: true };
}

/** Stamp (or clear) the employee-acknowledged flag once the signed copy is back. */
export async function setDisciplinaryAcknowledged(_prev: unknown, formData: FormData) {
  const user = await requireAuth();
  const gate = requireHrRole(user.role);
  if (gate) return gate;

  const id = formData.get("id") as string;
  const acknowledged = formData.get("acknowledged") === "true";

  const report = await db.disciplinaryReport.findFirst({
    where: { id, deletedAt: null },
    select: { id: true, employeeId: true, actionType: true },
  });
  if (!report) return { error: "Not found" };
  // The acknowledgement stamp stands in for the employee's signature —
  // the subject recording (or clearing) their own is exactly the
  // integrity hole to close.
  const selfGate = requireNotSubject(user.id, report.employeeId);
  if (selfGate) return selfGate;

  await db.disciplinaryReport.update({
    where: { id },
    data: { acknowledgedAt: acknowledged ? new Date() : null },
  });
  await logActivity(
    "updated",
    "disciplinary-report",
    id,
    user.id,
    `${DISCIPLINARY_ACTION_LABELS[report.actionType]} — ${acknowledged ? "acknowledged" : "acknowledgement cleared"}`
  );
  revalidatePath(`/team/${report.employeeId}`);
  return { success: true };
}

export async function deleteDisciplinaryReport(_prev: unknown, formData: FormData) {
  const user = await requireAuth();
  // Deleting HR records is admin-only — managers can create and amend.
  if (user.role !== "ADMIN") {
    return { error: "Only admins can delete disciplinary reports" };
  }

  const id = formData.get("id") as string;
  const report = await db.disciplinaryReport.findFirst({
    where: { id, deletedAt: null },
    select: { id: true, employeeId: true, actionType: true },
  });
  if (!report) return { error: "Not found" };
  const selfGate = requireNotSubject(user.id, report.employeeId);
  if (selfGate) return selfGate;

  await db.disciplinaryReport.update({
    where: { id },
    data: { deletedAt: new Date() },
  });
  await logActivity("soft-deleted", "disciplinary-report", id, user.id, DISCIPLINARY_ACTION_LABELS[report.actionType]);
  revalidatePath(`/team/${report.employeeId}`);
  return { success: true };
}
