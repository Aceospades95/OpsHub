"use server";

import { db } from "@/lib/db";
import { requireAuth, resolveModulePerms } from "@/lib/permissions";
import { logActivity } from "@/lib/activity";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { nameField } from "@/lib/validation";
import { vehicleLabel } from "@/lib/fleet";

/**
 * Vehicle fleet actions. Fleet is a permissioned module (Manager+ by
 * default; grantable per-user) and vehicles aren't a scoped entity type,
 * so gates are module-level. Adding a maintenance record with a next-due
 * date rolls the vehicle's nextServiceDate forward and re-arms the
 * maintenance notification (clears maintenanceNotifiedFor).
 */

const VEHICLE_STATUSES = ["ACTIVE", "IN_SHOP", "RETIRED", "SOLD"] as const;

const CURRENT_YEAR_MAX = 2100;

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
  notes: z.string().max(10000).optional(),
});

function parseVehicleForm(formData: FormData) {
  const opt = (key: string) => {
    const value = formData.get(key);
    return value === null || value === "" ? undefined : String(value);
  };
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
    const vehicle = await db.vehicle.create({ data: vehicleData(parsed.data) });
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
    select: { id: true, nextServiceDate: true },
  });
  if (!existing) return { error: "Not found" };

  const data = vehicleData(parsed.data);
  const nextServiceChanged =
    (existing.nextServiceDate?.getTime() ?? null) !== (data.nextServiceDate?.getTime() ?? null);

  try {
    const vehicle = await db.vehicle.update({
      where: { id },
      data: {
        ...data,
        // A new service date re-arms the due-soon notification.
        ...(nextServiceChanged ? { maintenanceNotifiedFor: null } : {}),
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

  const opt = (key: string) => {
    const value = formData.get(key);
    return value === null || value === "" ? undefined : String(value);
  };
  const parsed = maintenanceSchema.safeParse({
    vehicleId: formData.get("vehicleId"),
    serviceDate: formData.get("serviceDate"),
    serviceType: formData.get("serviceType"),
    odometer: opt("odometer"),
    cost: opt("cost"),
    vendor: opt("vendor"),
    notes: opt("notes"),
    nextDueDate: opt("nextDueDate"),
    nextDueMileage: opt("nextDueMileage"),
  });
  if (!parsed.success) {
    return { error: parsed.error.errors[0].message, fieldErrors: parsed.error.flatten().fieldErrors };
  }
  const data = parsed.data;

  const vehicle = await db.vehicle.findFirst({
    where: { id: data.vehicleId, deletedAt: null },
    select: { id: true, currentMileage: true },
  });
  if (!vehicle) return { error: "Vehicle not found" };

  await db.$transaction([
    db.vehicleMaintenanceRecord.create({
      data: {
        vehicleId: data.vehicleId,
        serviceDate: new Date(data.serviceDate),
        serviceType: data.serviceType,
        odometer: data.odometer ?? null,
        cost: data.cost ?? null,
        vendor: data.vendor?.trim() || null,
        notes: data.notes?.trim() || null,
        nextDueDate: data.nextDueDate ? new Date(data.nextDueDate) : null,
        nextDueMileage: data.nextDueMileage ?? null,
      },
    }),
    db.vehicle.update({
      where: { id: data.vehicleId },
      data: {
        // Service happened: roll the vehicle's schedule forward and
        // re-arm the notification. A record without a next-due date
        // clears the schedule (nothing planned).
        nextServiceDate: data.nextDueDate ? new Date(data.nextDueDate) : null,
        nextServiceMileage: data.nextDueMileage ?? null,
        maintenanceNotifiedFor: null,
        // Odometer readings only ever move forward.
        ...(data.odometer && data.odometer > (vehicle.currentMileage ?? 0)
          ? { currentMileage: data.odometer }
          : {}),
      },
    }),
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
