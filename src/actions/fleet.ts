"use server";

import { db } from "@/lib/db";
import { requireAuth, resolveModulePerms } from "@/lib/permissions";
import { logActivity } from "@/lib/activity";
import { log } from "@/lib/log";
import { notify, type NotificationType } from "@/lib/notifications";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { nameField, rejectHtmlChars, HTML_CHARS_MESSAGE } from "@/lib/validation";
import { vehicleLabel } from "@/lib/fleet";

/**
 * Vehicle fleet actions. Fleet is a permissioned module (Manager+ by
 * default; grantable per-user). Assigned drivers additionally get scoped
 * VIEW of their own vehicles (scope.vehicleIds) — writes stay
 * module-gated, so these actions check module flags only, with ONE
 * deliberate exception: logMaintenance also accepts the vehicle's
 * assigned driver (vehicle.assignedToId === user.id), because the whole
 * point of the driver submission flow is that drivers report completed
 * service without holding fleet edit perms. Adding a maintenance record
 * with a next-due date rolls the vehicle's nextServiceDate forward and
 * re-arms the maintenance notification (clears maintenanceNotifiedFor)
 * — but only when the record is the vehicle's most recent service;
 * backfilling history never rewinds the live schedule.
 */

/**
 * Emitted when a driver submits the log-maintenance form. Registered
 * centrally in the notification-type registry (landing with the
 * concurrent notification-rules work); the cast keeps this module
 * compiling against the current union either way. In-app only — no
 * email block is passed.
 */
const MAINTENANCE_LOGGED_TYPE = "vehicle-maintenance-logged" as string as NotificationType;

const VEHICLE_STATUSES = ["ACTIVE", "IN_SHOP", "RETIRED", "SOLD"] as const;

const CURRENT_YEAR_MAX = 2100;

/** FormData accessor: empty string / missing → undefined (zod optional). */
function optField(formData: FormData, key: string): string | undefined {
  const value = formData.get(key);
  return value === null || value === "" ? undefined : String(value);
}

const vehicleSchema = z.object({
  nickname: z.string().max(100).optional(),
  make: nameField({ label: "Make", max: 100 }),
  model: nameField({ label: "Model", max: 100 }),
  year: z.coerce.number().int().min(1950, "Year looks wrong").max(CURRENT_YEAR_MAX, "Year looks wrong"),
  vin: z.string().max(30).optional(),
  licensePlate: z.string().max(20).optional(),
  status: z.enum(VEHICLE_STATUSES).optional(),
  assignedToId: z.string().optional(),
  currentMileage: z.coerce.number().int().min(0).optional(),
  nextServiceDate: z.string().optional(),
  nextServiceMileage: z.coerce.number().int().min(0).optional(),
  registrationExpiresAt: z.string().optional(),
  notes: z.string().max(10000).optional(),
});

function parseVehicleForm(formData: FormData) {
  const opt = (key: string) => optField(formData, key);
  return vehicleSchema.safeParse({
    nickname: opt("nickname"),
    make: formData.get("make"),
    model: formData.get("model"),
    year: formData.get("year"),
    vin: opt("vin"),
    licensePlate: opt("licensePlate"),
    status: opt("status") ?? "ACTIVE",
    assignedToId: opt("assignedToId"),
    currentMileage: opt("currentMileage"),
    nextServiceDate: opt("nextServiceDate"),
    nextServiceMileage: opt("nextServiceMileage"),
    registrationExpiresAt: opt("registrationExpiresAt"),
    notes: opt("notes"),
  });
}

function vehicleData(data: z.infer<typeof vehicleSchema>) {
  return {
    nickname: data.nickname?.trim() || null,
    make: data.make,
    model: data.model,
    year: data.year,
    vin: data.vin?.trim().toUpperCase() || null,
    licensePlate: data.licensePlate?.trim().toUpperCase() || null,
    status: data.status ?? "ACTIVE",
    assignedToId: data.assignedToId || null,
    currentMileage: data.currentMileage ?? null,
    nextServiceDate: data.nextServiceDate ? new Date(data.nextServiceDate) : null,
    nextServiceMileage: data.nextServiceMileage ?? null,
    registrationExpiresAt: data.registrationExpiresAt ? new Date(data.registrationExpiresAt) : null,
    notes: data.notes?.trim() || null,
  };
}

export async function createVehicle(_prev: unknown, formData: FormData) {
  const user = await requireAuth();
  const perms = await resolveModulePerms(user.id, user.role, "fleet");
  if (!perms.canCreate) return { error: "Permission denied" };

  const parsed = parseVehicleForm(formData);
  if (!parsed.success) {
    return { error: parsed.error.errors[0].message, fieldErrors: parsed.error.flatten().fieldErrors };
  }

  try {
    const vehicle = await db.vehicle.create({
      data: {
        ...vehicleData(parsed.data),
        // Staleness signal for mileage-based due estimates.
        ...(parsed.data.currentMileage != null ? { mileageUpdatedAt: new Date() } : {}),
      },
    });
    await logActivity("created", "vehicle", vehicle.id, user.id, vehicleLabel(vehicle));
    revalidatePath("/fleet");
    return { success: true, id: vehicle.id };
  } catch (err) {
    if ((err as { code?: string }).code === "P2002") {
      return { error: "A vehicle with this VIN already exists" };
    }
    throw err;
  }
}

export async function updateVehicle(_prev: unknown, formData: FormData) {
  const user = await requireAuth();
  const perms = await resolveModulePerms(user.id, user.role, "fleet");
  if (!perms.canEdit) return { error: "Permission denied" };

  const id = formData.get("id") as string;
  const parsed = parseVehicleForm(formData);
  if (!parsed.success) {
    return { error: parsed.error.errors[0].message, fieldErrors: parsed.error.flatten().fieldErrors };
  }

  const existing = await db.vehicle.findFirst({
    where: { id, deletedAt: null },
    select: { id: true, nextServiceDate: true, currentMileage: true },
  });
  if (!existing) return { error: "Not found" };

  const data = vehicleData(parsed.data);
  const nextServiceChanged =
    (existing.nextServiceDate?.getTime() ?? null) !== (data.nextServiceDate?.getTime() ?? null);
  // A manual odometer entry is a mileage report — refresh the
  // staleness timestamp. Clearing the field isn't a report.
  const mileageReported =
    data.currentMileage != null && data.currentMileage !== existing.currentMileage;

  try {
    const vehicle = await db.vehicle.update({
      where: { id },
      data: {
        ...data,
        // A new service date re-arms the due-soon notification.
        ...(nextServiceChanged ? { maintenanceNotifiedFor: null } : {}),
        ...(mileageReported ? { mileageUpdatedAt: new Date() } : {}),
      },
    });
    await logActivity("updated", "vehicle", id, user.id, vehicleLabel(vehicle));
    revalidatePath("/fleet");
    revalidatePath(`/fleet/${id}`);
    return { success: true };
  } catch (err) {
    if ((err as { code?: string }).code === "P2002") {
      return { error: "A vehicle with this VIN already exists" };
    }
    throw err;
  }
}

export async function deleteVehicle(_prev: unknown, formData: FormData) {
  const user = await requireAuth();
  const perms = await resolveModulePerms(user.id, user.role, "fleet");
  if (!perms.canDelete) return { error: "Permission denied" };

  const id = formData.get("id") as string;
  const vehicle = await db.vehicle.findUnique({ where: { id } });
  if (!vehicle) return { error: "Not found" };
  if (vehicle.deletedAt) return { error: "Already in the recovery bin" };

  await db.vehicle.update({ where: { id }, data: { deletedAt: new Date() } });
  await logActivity("soft-deleted", "vehicle", id, user.id, vehicleLabel(vehicle));
  revalidatePath("/fleet");
  return { success: true };
}

// ─── Maintenance records ──────────────────────────────────────────

const maintenanceSchema = z.object({
  vehicleId: z.string().min(1),
  serviceDate: z.string().min(1, "Service date is required"),
  serviceType: nameField({ label: "Service type", max: 200 }),
  odometer: z.coerce.number().int().min(0).optional(),
  cost: z.coerce.number().min(0).optional(),
  vendor: z.string().max(200).optional(),
  notes: z.string().max(10000).optional(),
  nextDueDate: z.string().optional(),
  nextDueMileage: z.coerce.number().int().min(0).optional(),
});

export async function addMaintenanceRecord(_prev: unknown, formData: FormData) {
  const user = await requireAuth();
  const perms = await resolveModulePerms(user.id, user.role, "fleet");
  if (!perms.canEdit) return { error: "Permission denied" };

  const parsed = maintenanceSchema.safeParse({
    vehicleId: formData.get("vehicleId"),
    serviceDate: formData.get("serviceDate"),
    serviceType: formData.get("serviceType"),
    odometer: optField(formData, "odometer"),
    cost: optField(formData, "cost"),
    vendor: optField(formData, "vendor"),
    notes: optField(formData, "notes"),
    nextDueDate: optField(formData, "nextDueDate"),
    nextDueMileage: optField(formData, "nextDueMileage"),
  });
  if (!parsed.success) {
    return { error: parsed.error.errors[0].message, fieldErrors: parsed.error.flatten().fieldErrors };
  }
  const data = parsed.data;

  const [vehicle, latestRecord] = await Promise.all([
    db.vehicle.findFirst({
      where: { id: data.vehicleId, deletedAt: null },
      select: { id: true, currentMileage: true, serviceSchedules: true },
    }),
    db.vehicleMaintenanceRecord.findFirst({
      where: { vehicleId: data.vehicleId },
      orderBy: { serviceDate: "desc" },
      select: { serviceDate: true },
    }),
  ]);
  if (!vehicle) return { error: "Vehicle not found" };

  const serviceDate = new Date(data.serviceDate);
  // Only the vehicle's MOST RECENT service moves the live schedule.
  // Backfilling a forgotten older record must never wipe the upcoming
  // service or rewind it into the past (which would fire a spurious
  // overdue notification).
  const isLatestService = !latestRecord || serviceDate.getTime() >= latestRecord.serviceDate.getTime();

  const vehicleUpdates: Record<string, unknown> = {
    // Odometer readings only ever move forward — safe for backfills too,
    // since an old reading can only raise a stale/unset current value.
    ...(data.odometer && data.odometer > (vehicle.currentMileage ?? 0)
      ? { currentMileage: data.odometer, mileageUpdatedAt: new Date() }
      : {}),
    ...(isLatestService
      ? {
          // Service happened: roll the vehicle's schedule forward and
          // re-arm the notification. A record without a next-due date
          // clears the schedule (nothing planned).
          nextServiceDate: data.nextDueDate ? new Date(data.nextDueDate) : null,
          nextServiceMileage: data.nextDueMileage ?? null,
          maintenanceNotifiedFor: null,
        }
      : {}),
  };

  await db.$transaction([
    db.vehicleMaintenanceRecord.create({
      data: {
        vehicleId: data.vehicleId,
        serviceDate,
        serviceType: data.serviceType,
        odometer: data.odometer ?? null,
        cost: data.cost ?? null,
        vendor: data.vendor?.trim() || null,
        notes: data.notes?.trim() || null,
        nextDueDate: data.nextDueDate ? new Date(data.nextDueDate) : null,
        nextDueMileage: data.nextDueMileage ?? null,
      },
    }),
    // A record whose type matches a per-service-type schedule also
    // rolls that schedule's baseline forward (forward-only, same
    // backfill rule as above) so both logging paths stay consistent.
    ...scheduleRearmWrites(
      vehicle.serviceSchedules,
      [data.serviceType],
      serviceDate,
      data.odometer ?? vehicle.currentMileage ?? null
    ),
    ...(Object.keys(vehicleUpdates).length > 0
      ? [db.vehicle.update({ where: { id: data.vehicleId }, data: vehicleUpdates })]
      : []),
  ]);

  await logActivity("created", "vehicle-maintenance", data.vehicleId, user.id, data.serviceType);
  revalidatePath("/fleet");
  revalidatePath(`/fleet/${data.vehicleId}`);
  return { success: true };
}

export async function deleteMaintenanceRecord(_prev: unknown, formData: FormData) {
  const user = await requireAuth();
  const perms = await resolveModulePerms(user.id, user.role, "fleet");
  if (!perms.canDelete) return { error: "Permission denied" };

  const id = formData.get("id") as string;
  const record = await db.vehicleMaintenanceRecord.findUnique({
    where: { id },
    select: { id: true, vehicleId: true, serviceType: true },
  });
  if (!record) return { error: "Not found" };

  await db.vehicleMaintenanceRecord.delete({ where: { id } });
  await logActivity("deleted", "vehicle-maintenance", record.vehicleId, user.id, record.serviceType);
  revalidatePath(`/fleet/${record.vehicleId}`);
  return { success: true };
}

// ─── Driver "Log maintenance" submission ──────────────────────────

/**
 * Prisma writes that roll matching service schedules forward after a
 * service is logged. Matching is a case-insensitive trim match on
 * serviceType. Baselines only ever move FORWARD: a backfilled older
 * record never rewinds lastServiceDate, and lastServiceMileage never
 * decreases. Each re-armed row clears notifiedForDueAt so the
 * maintenance job fires again for the next cycle.
 */
function scheduleRearmWrites(
  schedules: {
    id: string;
    serviceType: string;
    lastServiceDate: Date | null;
    lastServiceMileage: number | null;
  }[],
  serviceTypes: string[],
  serviceDate: Date,
  reportedMileage: number | null
) {
  const wanted = new Set(serviceTypes.map((t) => t.trim().toLowerCase()));
  const writes = [];
  for (const schedule of schedules) {
    if (!wanted.has(schedule.serviceType.trim().toLowerCase())) continue;
    // Only forward — a backfilled older record leaves the schedule alone.
    if (schedule.lastServiceDate && serviceDate.getTime() < schedule.lastServiceDate.getTime()) {
      continue;
    }
    const lastServiceMileage =
      reportedMileage != null
        ? Math.max(reportedMileage, schedule.lastServiceMileage ?? 0)
        : schedule.lastServiceMileage;
    writes.push(
      db.vehicleServiceSchedule.update({
        where: { id: schedule.id },
        data: { lastServiceDate: serviceDate, lastServiceMileage, notifiedForDueAt: null },
      })
    );
  }
  return writes;
}

const logMaintenanceSchema = z.object({
  vehicleId: z.string().min(1),
  serviceDate: z.string().min(1, "Service date is required"),
  odometer: z.coerce.number().int().min(0).optional(),
  cost: z.coerce.number().min(0).optional(),
  vendor: z.string().max(200).optional(),
  notes: z.string().max(10000).optional(),
});

/**
 * The driver-facing submission flow: one form logs one shop visit that
 * may cover several service types. Permission is fleet canEdit OR being
 * the vehicle's assigned driver — drivers report their own completed
 * maintenance without holding module edit perms.
 *
 * Writes one VehicleMaintenanceRecord per selected service type (so
 * each matching schedule row stays individually re-armable), rolls the
 * matching schedules' baselines forward, and moves the vehicle odometer
 * when the reported reading is newer/higher. The LEGACY single
 * nextServiceDate on the vehicle is deliberately untouched here — that
 * field belongs to the manual vehicle-edit / add-record flow and the
 * schedule-less job path.
 */
export async function logMaintenance(_prev: unknown, formData: FormData) {
  const user = await requireAuth();
  const perms = await resolveModulePerms(user.id, user.role, "fleet");

  const parsed = logMaintenanceSchema.safeParse({
    vehicleId: formData.get("vehicleId"),
    serviceDate: formData.get("serviceDate"),
    odometer: optField(formData, "odometer"),
    cost: optField(formData, "cost"),
    vendor: optField(formData, "vendor"),
    notes: optField(formData, "notes"),
  });
  if (!parsed.success) {
    return { error: parsed.error.errors[0].message, fieldErrors: parsed.error.flatten().fieldErrors };
  }
  const data = parsed.data;

  // One-or-more service types: the checked schedule types plus an
  // optional free-text "Other…" entry, deduped case-insensitively.
  const rawTypes = [
    ...formData.getAll("serviceTypes").map((value) => String(value)),
    optField(formData, "otherServiceType") ?? "",
  ];
  const serviceTypes: string[] = [];
  const seen = new Set<string>();
  for (const raw of rawTypes) {
    const type = raw.trim();
    if (!type) continue;
    if (type.length > 200) return { error: "Service type must be at most 200 characters" };
    if (!rejectHtmlChars(type)) return { error: HTML_CHARS_MESSAGE };
    const key = type.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    serviceTypes.push(type);
  }
  if (serviceTypes.length === 0) return { error: "Select at least one service type" };

  const serviceDate = new Date(data.serviceDate);
  if (Number.isNaN(serviceDate.getTime())) return { error: "Service date looks wrong" };

  const vehicle = await db.vehicle.findFirst({
    where: { id: data.vehicleId, deletedAt: null },
    include: { serviceSchedules: true },
  });
  if (!vehicle) return { error: "Vehicle not found" };

  // Three-gate exception documented at the top of this file: assigned
  // drivers may log maintenance for their own vehicle without module
  // edit perms.
  const isAssignedDriver = vehicle.assignedToId === user.id;
  if (!perms.canEdit && !isAssignedDriver) return { error: "Permission denied" };

  const now = new Date();
  // One record per service type. The visit-level cost and notes land on
  // the FIRST record only so lifetime-cost sums don't double-count a
  // combined invoice; the vendor applies to every line.
  const records = serviceTypes.map((serviceType, index) => ({
    vehicleId: vehicle.id,
    serviceDate,
    serviceType,
    odometer: data.odometer ?? null,
    cost: index === 0 ? data.cost ?? null : null,
    vendor: data.vendor?.trim() || null,
    notes: index === 0 ? data.notes?.trim() || null : null,
  }));

  // Odometer readings only move forward; an equal reading still
  // refreshes the staleness timestamp (it IS a fresh report).
  const vehicleWrites =
    data.odometer != null && data.odometer >= (vehicle.currentMileage ?? 0)
      ? [
          db.vehicle.update({
            where: { id: vehicle.id },
            data: { currentMileage: data.odometer, mileageUpdatedAt: now },
          }),
        ]
      : [];

  await db.$transaction([
    db.vehicleMaintenanceRecord.createMany({ data: records }),
    // When no odometer was entered, fall back to the vehicle's current
    // reading as the best available baseline estimate for the schedules.
    ...scheduleRearmWrites(
      vehicle.serviceSchedules,
      serviceTypes,
      serviceDate,
      data.odometer ?? vehicle.currentMileage ?? null
    ),
    ...vehicleWrites,
  ]);

  await logActivity("created", "vehicle-maintenance", vehicle.id, user.id, serviceTypes.join(", "));

  // Office heads-up when a DRIVER (someone without fleet edit perms)
  // submits, so the office knows without checking. In-app only.
  if (!perms.canEdit) {
    try {
      const officeUsers = await db.user.findMany({
        where: { isActive: true, role: { in: ["ADMIN", "MANAGER"] }, id: { not: user.id } },
        select: { id: true },
      });
      if (officeUsers.length > 0) {
        const label = vehicleLabel(vehicle);
        await notify({
          recipientId: officeUsers.map((u) => u.id),
          type: MAINTENANCE_LOGGED_TYPE,
          title: `Maintenance logged: ${label}`,
          body: `${user.name} logged ${serviceTypes.join(", ")}${
            data.odometer != null ? ` at ${data.odometer.toLocaleString()} mi` : ""
          }`,
          href: `/fleet/${vehicle.id}`,
          entityType: "vehicle",
          entityId: vehicle.id,
          actorId: user.id,
        });
      }
    } catch (err) {
      // The submission already committed — a notification hiccup
      // shouldn't fail the driver's form.
      log.error("fleet.logMaintenance", "Notify failed", err, { vehicleId: vehicle.id });
    }
  }

  revalidatePath("/fleet");
  revalidatePath(`/fleet/${vehicle.id}`);
  return { success: true };
}

// ─── Service schedules ────────────────────────────────────────────
//
// Per-service-type recurring plans (VehicleServiceSchedule) — the
// spreadsheet's "Oil Change every 3 months / 4,000 miles" rows. Due
// state is computed in lib/fleet (scheduleDueState); these actions
// manage the rows themselves. Module-gated on fleet canEdit, matching
// the task's "add/edit/delete for canEdit users".

const scheduleSchema = z
  .object({
    vehicleId: z.string().min(1),
    serviceType: nameField({ label: "Service type", max: 100 }),
    everyMonths: z.coerce.number().int().min(1, "Interval must be at least 1 month").max(120).optional(),
    everyMiles: z.coerce.number().int().min(1, "Interval must be at least 1 mile").max(1000000).optional(),
    lastServiceDate: z.string().optional(),
    lastServiceMileage: z.coerce.number().int().min(0).optional(),
    notes: z.string().max(2000).optional(),
  })
  .refine((data) => data.everyMonths != null || data.everyMiles != null, {
    message: "Set an interval in months, miles, or both",
    path: ["everyMonths"],
  });

function parseScheduleForm(formData: FormData, vehicleId: string) {
  return scheduleSchema.safeParse({
    vehicleId,
    serviceType: formData.get("serviceType"),
    everyMonths: optField(formData, "everyMonths"),
    everyMiles: optField(formData, "everyMiles"),
    lastServiceDate: optField(formData, "lastServiceDate"),
    lastServiceMileage: optField(formData, "lastServiceMileage"),
    notes: optField(formData, "notes"),
  });
}

const DUPLICATE_SCHEDULE_ERROR = "This vehicle already has a schedule for that service type";

export async function createServiceSchedule(_prev: unknown, formData: FormData) {
  const user = await requireAuth();
  const perms = await resolveModulePerms(user.id, user.role, "fleet");
  if (!perms.canEdit) return { error: "Permission denied" };

  const parsed = parseScheduleForm(formData, String(formData.get("vehicleId") ?? ""));
  if (!parsed.success) {
    return { error: parsed.error.errors[0].message, fieldErrors: parsed.error.flatten().fieldErrors };
  }
  const data = parsed.data;
  const serviceType = data.serviceType.trim();

  const vehicle = await db.vehicle.findFirst({
    where: { id: data.vehicleId, deletedAt: null },
    select: { id: true },
  });
  if (!vehicle) return { error: "Vehicle not found" };

  // Friendly duplicate check, case-insensitive: logging matches
  // schedules case-insensitively, so "oil change" next to "Oil Change"
  // would double-arm. The DB unique constraint (exact match) backstops.
  const duplicate = await db.vehicleServiceSchedule.findFirst({
    where: {
      vehicleId: data.vehicleId,
      serviceType: { equals: serviceType, mode: "insensitive" },
    },
    select: { id: true },
  });
  if (duplicate) return { error: DUPLICATE_SCHEDULE_ERROR };

  try {
    await db.vehicleServiceSchedule.create({
      data: {
        vehicleId: data.vehicleId,
        serviceType,
        everyMonths: data.everyMonths ?? null,
        everyMiles: data.everyMiles ?? null,
        lastServiceDate: data.lastServiceDate ? new Date(data.lastServiceDate) : null,
        lastServiceMileage: data.lastServiceMileage ?? null,
        notes: data.notes?.trim() || null,
      },
    });
  } catch (err) {
    if ((err as { code?: string }).code === "P2002") {
      return { error: DUPLICATE_SCHEDULE_ERROR };
    }
    throw err;
  }

  await logActivity("created", "vehicle-service-schedule", data.vehicleId, user.id, serviceType);
  revalidatePath("/fleet");
  revalidatePath(`/fleet/${data.vehicleId}`);
  return { success: true };
}

export async function updateServiceSchedule(_prev: unknown, formData: FormData) {
  const user = await requireAuth();
  const perms = await resolveModulePerms(user.id, user.role, "fleet");
  if (!perms.canEdit) return { error: "Permission denied" };

  const id = formData.get("id") as string;
  const existing = await db.vehicleServiceSchedule.findFirst({
    where: { id, vehicle: { deletedAt: null } },
  });
  if (!existing) return { error: "Not found" };

  // vehicleId comes from the existing row, never the client.
  const parsed = parseScheduleForm(formData, existing.vehicleId);
  if (!parsed.success) {
    return { error: parsed.error.errors[0].message, fieldErrors: parsed.error.flatten().fieldErrors };
  }
  const data = parsed.data;
  const serviceType = data.serviceType.trim();

  const duplicate = await db.vehicleServiceSchedule.findFirst({
    where: {
      vehicleId: existing.vehicleId,
      id: { not: id },
      serviceType: { equals: serviceType, mode: "insensitive" },
    },
    select: { id: true },
  });
  if (duplicate) return { error: DUPLICATE_SCHEDULE_ERROR };

  const lastServiceDate = data.lastServiceDate ? new Date(data.lastServiceDate) : null;
  // Editing the cadence or baseline changes the computed due date, so
  // the notification must re-arm; a notes-only edit shouldn't.
  const baselineChanged =
    (existing.everyMonths ?? null) !== (data.everyMonths ?? null) ||
    (existing.everyMiles ?? null) !== (data.everyMiles ?? null) ||
    (existing.lastServiceDate?.getTime() ?? null) !== (lastServiceDate?.getTime() ?? null) ||
    (existing.lastServiceMileage ?? null) !== (data.lastServiceMileage ?? null);

  try {
    await db.vehicleServiceSchedule.update({
      where: { id },
      data: {
        serviceType,
        everyMonths: data.everyMonths ?? null,
        everyMiles: data.everyMiles ?? null,
        lastServiceDate,
        lastServiceMileage: data.lastServiceMileage ?? null,
        notes: data.notes?.trim() || null,
        ...(baselineChanged ? { notifiedForDueAt: null } : {}),
      },
    });
  } catch (err) {
    if ((err as { code?: string }).code === "P2002") {
      return { error: DUPLICATE_SCHEDULE_ERROR };
    }
    throw err;
  }

  await logActivity("updated", "vehicle-service-schedule", existing.vehicleId, user.id, serviceType);
  revalidatePath("/fleet");
  revalidatePath(`/fleet/${existing.vehicleId}`);
  return { success: true };
}

export async function deleteServiceSchedule(_prev: unknown, formData: FormData) {
  const user = await requireAuth();
  const perms = await resolveModulePerms(user.id, user.role, "fleet");
  if (!perms.canEdit) return { error: "Permission denied" };

  const id = formData.get("id") as string;
  const schedule = await db.vehicleServiceSchedule.findUnique({
    where: { id },
    select: { id: true, vehicleId: true, serviceType: true },
  });
  if (!schedule) return { error: "Not found" };

  await db.vehicleServiceSchedule.delete({ where: { id } });
  await logActivity("deleted", "vehicle-service-schedule", schedule.vehicleId, user.id, schedule.serviceType);
  revalidatePath("/fleet");
  revalidatePath(`/fleet/${schedule.vehicleId}`);
  return { success: true };
}
