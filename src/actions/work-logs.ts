"use server";

import { db } from "@/lib/db";
import { requireAuth, resolveModulePerms } from "@/lib/permissions";
import { logActivity } from "@/lib/activity";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { parseCalendarDateString, toCalendarDateString } from "@/lib/dates";
import {
  canManageWorkLogs,
  isValidWeekKey,
  isoWeekKey,
  shiftWeekKey,
  startOfUtcDay,
  weekBounds,
} from "@/lib/worklogs";

/**
 * Work-log actions. The module is permissioned ("work-logs"):
 *
 *   - canCreate  → submit/edit YOUR OWN daily log. Deliberately never
 *     someone else's — not even for admins. The log is the technician's
 *     own attestation of hours; if a day genuinely shouldn't be
 *     expected, managers record a ScheduleException instead of typing
 *     hours on someone's behalf. (The CSV importer is the audited
 *     escape hatch for migrating historical sheets.)
 *   - manage (canManage flag, or MANAGER role with module canEdit —
 *     see canManageWorkLogs) → schedule exceptions (PTO/sick/holiday,
 *     incl. org-wide) and weekly overtime approval, plus
 *     back-fill-window bypass on their own logs.
 *
 * Back-fill window: a log may be submitted for any date in the CURRENT
 * ISO week, or in the PREVIOUS week while the current week is still in
 * progress — the sheet's "complete missing logs before the end of the
 * week" rule. Anything older needs canManage.
 *
 * Duplicate same-day submissions UPSERT on (userId, workDate) — a
 * resubmission corrects the day instead of double-counting it, which
 * was one of the spreadsheet's failure modes.
 */

/** FormData accessor: empty string / missing → undefined (zod optional). */
function optField(formData: FormData, key: string): string | undefined {
  const value = formData.get(key);
  return value === null || value === "" ? undefined : String(value);
}

function revalidateWorkLogs() {
  revalidatePath("/work-logs");
  revalidatePath("/work-logs/team");
}

// ─── Submit / edit my own daily log ───────────────────────────────

const submitSchema = z.object({
  workDate: z.string().min(1, "Work date is required"),
  hours: z.coerce
    .number({ invalid_type_error: "Hours must be a number" })
    .min(0, "Hours can't be negative")
    .max(24, "Hours can't exceed 24 for one day"),
  sites: z.string().max(2000, "Tickets / sites must be at most 2000 characters").optional(),
  notes: z.string().max(10000, "Notes must be at most 10000 characters").optional(),
});

export async function submitWorkLog(_prev: unknown, formData: FormData) {
  const user = await requireAuth();
  const perms = await resolveModulePerms(user.id, user.role, "work-logs");
  if (!perms.canCreate) return { error: "Permission denied" };

  const parsed = submitSchema.safeParse({
    workDate: formData.get("workDate"),
    hours: formData.get("hours"),
    sites: optField(formData, "sites"),
    notes: optField(formData, "notes"),
  });
  if (!parsed.success) {
    return { error: parsed.error.errors[0].message, fieldErrors: parsed.error.flatten().fieldErrors };
  }

  const workDate = parseCalendarDateString(parsed.data.workDate);
  if (!workDate) return { error: "Enter a valid work date (YYYY-MM-DD)" };

  const today = startOfUtcDay(new Date());
  if (workDate.getTime() > today.getTime()) {
    return { error: "Work date can't be in the future" };
  }

  // Back-fill window: current ISO week + the previous week (which stays
  // open while the current week is in progress). Managers bypass.
  const previousWeekStart = weekBounds(shiftWeekKey(isoWeekKey(today), -1)).start;
  if (!canManageWorkLogs(user.role, perms) && workDate.getTime() < previousWeekStart.getTime()) {
    return {
      error:
        "That date is outside the back-fill window (this week and last week) — ask a manager to record it",
    };
  }

  const data = {
    hours: parsed.data.hours,
    sites: parsed.data.sites?.trim() || null,
    notes: parsed.data.notes?.trim() || null,
  };

  // SELF ONLY, always: the userId comes from the session, never the
  // form. Same-day resubmission updates the row (no double-counting).
  const row = await db.workLog.upsert({
    where: { userId_workDate: { userId: user.id, workDate } },
    update: data,
    create: { userId: user.id, workDate, ...data },
  });

  await logActivity(
    "submitted",
    "work-log",
    row.id,
    user.id,
    `${parsed.data.hours}h on ${toCalendarDateString(workDate)}`
  );
  revalidateWorkLogs();
  return { success: true };
}

// ─── Schedule exceptions (canManage) ──────────────────────────────

const EXCEPTION_TYPES = ["PTO", "SICK", "HOLIDAY", "UNPAID", "OTHER"] as const;

const exceptionSchema = z.object({
  id: z.string().optional(),
  /** Empty / missing = org-wide (company holiday). */
  userId: z.string().optional(),
  type: z.enum(EXCEPTION_TYPES, { errorMap: () => ({ message: "Pick an exception type" }) }),
  startDate: z.string().min(1, "Start date is required"),
  endDate: z.string().min(1, "End date is required"),
  approved: z.boolean(),
  notes: z.string().max(2000, "Notes must be at most 2000 characters").optional(),
});

export async function upsertScheduleException(_prev: unknown, formData: FormData) {
  const user = await requireAuth();
  const perms = await resolveModulePerms(user.id, user.role, "work-logs");
  if (!canManageWorkLogs(user.role, perms)) return { error: "Permission denied" };

  const parsed = exceptionSchema.safeParse({
    id: optField(formData, "id"),
    userId: optField(formData, "userId"),
    type: formData.get("type"),
    startDate: formData.get("startDate"),
    endDate: formData.get("endDate"),
    approved: formData.get("approved") === "on" || formData.get("approved") === "true",
    notes: optField(formData, "notes"),
  });
  if (!parsed.success) {
    return { error: parsed.error.errors[0].message, fieldErrors: parsed.error.flatten().fieldErrors };
  }

  const startDate = parseCalendarDateString(parsed.data.startDate);
  const endDate = parseCalendarDateString(parsed.data.endDate);
  if (!startDate || !endDate) return { error: "Enter valid dates (YYYY-MM-DD)" };
  if (endDate.getTime() < startDate.getTime()) {
    return { error: "End date must be on or after the start date" };
  }

  const userId = parsed.data.userId || null;
  let subjectLabel = "everyone (org-wide)";
  if (userId) {
    const subject = await db.user.findUnique({ where: { id: userId }, select: { name: true } });
    if (!subject) return { error: "Employee not found" };
    subjectLabel = subject.name;
  }

  const data = {
    userId,
    type: parsed.data.type,
    startDate,
    endDate,
    approved: parsed.data.approved,
    notes: parsed.data.notes?.trim() || null,
  };
  const rangeLabel = `${toCalendarDateString(startDate)}–${toCalendarDateString(endDate)}`;

  if (parsed.data.id) {
    const existing = await db.scheduleException.findUnique({
      where: { id: parsed.data.id },
      select: { id: true },
    });
    if (!existing) return { error: "Exception not found" };
    // createdById stays with the original author.
    await db.scheduleException.update({ where: { id: existing.id }, data });
    await logActivity(
      "updated",
      "schedule-exception",
      existing.id,
      user.id,
      `${parsed.data.type} ${rangeLabel} — ${subjectLabel}`
    );
  } else {
    const created = await db.scheduleException.create({
      data: { ...data, createdById: user.id },
    });
    await logActivity(
      "created",
      "schedule-exception",
      created.id,
      user.id,
      `${parsed.data.type} ${rangeLabel} — ${subjectLabel}`
    );
  }

  revalidateWorkLogs();
  return { success: true };
}

export async function deleteScheduleException(_prev: unknown, formData: FormData) {
  const user = await requireAuth();
  const perms = await resolveModulePerms(user.id, user.role, "work-logs");
  if (!canManageWorkLogs(user.role, perms)) return { error: "Permission denied" };

  const id = String(formData.get("id") ?? "");
  const exception = await db.scheduleException.findUnique({
    where: { id },
    select: { id: true, type: true, startDate: true, endDate: true, user: { select: { name: true } } },
  });
  if (!exception) return { error: "Not found" };

  await db.scheduleException.delete({ where: { id } });
  await logActivity(
    "deleted",
    "schedule-exception",
    id,
    user.id,
    `${exception.type} ${toCalendarDateString(exception.startDate)}–${toCalendarDateString(exception.endDate)} — ${exception.user?.name ?? "everyone (org-wide)"}`
  );
  revalidateWorkLogs();
  return { success: true };
}

// ─── Weekly overtime approval (canManage) ─────────────────────────

const overtimeSchema = z.object({
  userId: z.string().min(1),
  weekKey: z.string().min(1),
  approved: z.enum(["true", "false"]),
  note: z.string().max(500, "Note must be at most 500 characters").optional(),
});

export async function setOvertimeApproved(_prev: unknown, formData: FormData) {
  const user = await requireAuth();
  const perms = await resolveModulePerms(user.id, user.role, "work-logs");
  if (!canManageWorkLogs(user.role, perms)) return { error: "Permission denied" };

  const parsed = overtimeSchema.safeParse({
    userId: formData.get("userId"),
    weekKey: formData.get("weekKey"),
    approved: formData.get("approved"),
    note: optField(formData, "note"),
  });
  if (!parsed.success) return { error: parsed.error.errors[0].message };
  if (!isValidWeekKey(parsed.data.weekKey)) return { error: "Invalid week" };

  const subject = await db.user.findUnique({
    where: { id: parsed.data.userId },
    select: { id: true, name: true },
  });
  if (!subject) return { error: "Employee not found" };

  const approved = parsed.data.approved === "true";
  const note = parsed.data.note?.trim();

  // approvedById records the LAST person who decided either way, so a
  // revocation is attributable too.
  await db.workWeekFlag.upsert({
    where: { userId_weekKey: { userId: subject.id, weekKey: parsed.data.weekKey } },
    update: { overtimeApproved: approved, approvedById: user.id, ...(note ? { note } : {}) },
    create: {
      userId: subject.id,
      weekKey: parsed.data.weekKey,
      overtimeApproved: approved,
      approvedById: user.id,
      note: note || null,
    },
  });

  await logActivity(
    "updated",
    "work-week-flag",
    `${subject.id}:${parsed.data.weekKey}`,
    user.id,
    `${approved ? "Approved" : "Revoked"} overtime for ${subject.name} (${parsed.data.weekKey})`
  );
  revalidateWorkLogs();
  return { success: true };
}

// ─── Roster enrollment (canManage) ────────────────────────────────

/**
 * Enroll / un-enroll a person in daily work logs — the opt-in roster
 * (the old sheet's Config tab). Only enrolled people are expected to
 * submit, get reminders, or appear in the team matrix. Enrollment
 * stamps workLogRequiredSince so days before it are never "missing";
 * re-enrolling refreshes the stamp for the same reason.
 */
export async function setWorkLogEnrollment(userId: string, enrolled: boolean) {
  const user = await requireAuth();
  const perms = await resolveModulePerms(user.id, user.role, "work-logs");
  if (!canManageWorkLogs(user.role, perms)) return { error: "Permission denied" } as const;

  const target = await db.user.findFirst({
    where: { id: userId, isActive: true },
    select: { id: true, name: true },
  });
  if (!target) return { error: "User not found" } as const;

  await db.user.update({
    where: { id: userId },
    data: {
      workLogRequired: enrolled,
      workLogRequiredSince: enrolled ? new Date() : null,
    },
  });
  await logActivity(
    "updated",
    "work-log-roster",
    userId,
    user.id,
    `${target.name} ${enrolled ? "enrolled in" : "removed from"} daily work logs`
  );
  revalidatePath("/work-logs");
  revalidatePath("/work-logs/team");
  return { success: true } as const;
}
