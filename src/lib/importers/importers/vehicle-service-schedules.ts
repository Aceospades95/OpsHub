/**
 * Vehicle service schedules importer — bulk-create or update the
 * recurring per-vehicle service plans ("Oil Change every 3 months /
 * 4,000 miles") from the fleet spreadsheet's Service Overview sheet.
 *
 * Required: licensePlate (must resolve to an existing vehicle — hard
 * fail otherwise), serviceType, and at least one of everyMonths /
 * everyMiles (a schedule with neither bound can never come due).
 *
 * Optional: lastServiceDate, lastServiceMileage, notes.
 *
 * Match key: (vehicle + serviceType), serviceType trimmed and matched
 * case-insensitively so "oil change" doesn't fork "Oil Change" (the
 * DB unique constraint is case-sensitive; forgiving matching prevents
 * near-duplicate rows).
 */

import { db } from "@/lib/db";
import type { ImporterDefinition, ImportRowResult } from "../types";
import {
  applyMode,
  buildResult,
  logImportActivity,
  mergeFillBlanks,
  skipExistsMessage,
  skipNoMatchMessage,
  warnList,
} from "../helpers";
import { normalizePlate } from "./vehicles";

function scheduleMatchKey(vehicleId: string, serviceType: string): string {
  return `${vehicleId}|${serviceType.trim().toLowerCase()}`;
}

function parseIntOrNull(v: string | undefined): number | null {
  if (!v || v.trim() === "") return null;
  const n = parseInt(v.replace(/[,\s]/g, ""), 10);
  return Number.isFinite(n) ? n : null;
}

function parseDate(v: string | undefined): Date | null {
  if (!v || v.trim() === "") return null;
  const d = new Date(v.trim());
  return isNaN(d.getTime()) ? null : d;
}

function formatDate(d: Date | null | undefined): string {
  return d ? d.toISOString().slice(0, 10) : "";
}

export const vehicleServiceSchedulesImporter: ImporterDefinition = {
  key: "vehicle-service-schedules",
  name: "Vehicle Service Schedules",
  description:
    "Bulk-create or update recurring service plans per vehicle. Required: licensePlate (existing vehicle), serviceType, and everyMonths and/or everyMiles. Optional: last service date/mileage, notes.",
  module: "fleet",
  supportsUpsert: true,
  upsertKeyDescription:
    "Matched by (vehicle license plate + service type), case-insensitive. Re-uploading the same service type for the same vehicle updates the existing schedule.",

  fields: [
    {
      key: "licensePlate",
      label: "License plate",
      required: true,
      description: "Plate of an existing vehicle (whitespace/case ignored). Rows with an unknown plate fail — import vehicles first.",
      aliases: ["plate", "vehicle", "vehicle plate", "tag"],
    },
    {
      key: "serviceType",
      label: "Service type",
      required: true,
      description: "Service label, e.g. \"Oil Change\". Matches VehicleMaintenanceRecord.serviceType so logged services re-arm the schedule.",
      aliases: ["service", "type", "maintenance type"],
    },
    {
      key: "everyMonths",
      label: "Every N months",
      required: false,
      description: "Time bound. At least one of everyMonths / everyMiles is required.",
      aliases: ["months", "interval months", "every months"],
    },
    {
      key: "everyMiles",
      label: "Every N miles",
      required: false,
      description: "Mileage bound. Commas are OK (\"4,000\"). At least one of everyMonths / everyMiles is required.",
      aliases: ["miles", "interval miles", "every miles"],
    },
    {
      key: "lastServiceDate",
      label: "Last service date",
      required: false,
      description: "ISO date (YYYY-MM-DD) this service was last performed.",
      aliases: ["last service", "last serviced", "last done"],
    },
    {
      key: "lastServiceMileage",
      label: "Last service mileage",
      required: false,
      description: "Odometer reading at the last service.",
      aliases: ["last mileage", "mileage at last service"],
    },
    { key: "notes", label: "Notes", required: false, aliases: ["comments"] },
  ],

  async sampleRows() {
    const schedules = await db.vehicleServiceSchedule.findMany({
      orderBy: { createdAt: "desc" },
      take: 3,
      include: { vehicle: { select: { licensePlate: true } } },
    });
    return schedules.map((s) => ({
      licensePlate: s.vehicle.licensePlate || "",
      serviceType: s.serviceType,
      everyMonths: s.everyMonths != null ? String(s.everyMonths) : "",
      everyMiles: s.everyMiles != null ? String(s.everyMiles) : "",
      lastServiceDate: formatDate(s.lastServiceDate),
      lastServiceMileage: s.lastServiceMileage != null ? String(s.lastServiceMileage) : "",
      notes: s.notes || "",
    }));
  },

  async exportRows() {
    const schedules = await db.vehicleServiceSchedule.findMany({
      orderBy: [{ vehicleId: "asc" }, { serviceType: "asc" }],
      include: { vehicle: { select: { licensePlate: true, deletedAt: true } } },
    });
    return schedules
      .filter((s) => s.vehicle.deletedAt === null)
      .map((s) => ({
        licensePlate: s.vehicle.licensePlate || "",
        serviceType: s.serviceType,
        everyMonths: s.everyMonths != null ? String(s.everyMonths) : "",
        everyMiles: s.everyMiles != null ? String(s.everyMiles) : "",
        lastServiceDate: formatDate(s.lastServiceDate),
        lastServiceMileage: s.lastServiceMileage != null ? String(s.lastServiceMileage) : "",
        notes: s.notes || "",
      }));
  },

  async commit(rows, ctx) {
    const db = ctx.db; // ALL commit reads/writes go through ctx.db
    const results: ImportRowResult[] = [];

    // Vehicles by normalized plate — the hard-fail FK.
    const vehicles = await db.vehicle.findMany({
      where: { deletedAt: null },
      select: { id: true, licensePlate: true },
    });
    const vehicleByPlate = new Map(
      vehicles
        .filter((v): v is typeof v & { licensePlate: string } => Boolean(v.licensePlate))
        .map((v) => [normalizePlate(v.licensePlate), v.id])
    );

    // Existing schedules keyed by (vehicleId + lowercased serviceType).
    const existingSchedules = await db.vehicleServiceSchedule.findMany({
      select: { id: true, vehicleId: true, serviceType: true },
    });
    const existingByKey = new Map<string, { id: string }>(
      existingSchedules.map((s) => [scheduleMatchKey(s.vehicleId, s.serviceType), { id: s.id }])
    );
    const seenInBatch = new Set<string>();

    for (let i = 0; i < rows.length; i++) {
      const rowNumber = i + 1;
      const raw = rows[i];
      const warnings: string[] = [];

      const plateRaw = (raw.licensePlate || "").trim();
      const serviceType = (raw.serviceType || "").trim();

      if (!plateRaw) {
        results.push({ row: rowNumber, status: "failed", message: "Missing licensePlate" });
        continue;
      }
      if (!serviceType) {
        results.push({ row: rowNumber, status: "failed", message: "Missing serviceType" });
        continue;
      }

      const vehicleId = vehicleByPlate.get(normalizePlate(plateRaw));
      if (!vehicleId) {
        results.push({
          row: rowNumber,
          status: "failed",
          message: `Vehicle not found for plate "${plateRaw}" — import vehicles first`,
        });
        continue;
      }

      const everyMonths = parseIntOrNull(raw.everyMonths);
      if ((raw.everyMonths || "").trim() && everyMonths === null) {
        warnings.push(`Could not parse everyMonths "${(raw.everyMonths || "").trim()}"`);
      }
      const everyMiles = parseIntOrNull(raw.everyMiles);
      if ((raw.everyMiles || "").trim() && everyMiles === null) {
        warnings.push(`Could not parse everyMiles "${(raw.everyMiles || "").trim()}"`);
      }
      if (everyMonths === null && everyMiles === null) {
        results.push({
          row: rowNumber,
          status: "failed",
          message: "At least one of everyMonths / everyMiles is required (a schedule with neither bound can never come due)",
        });
        continue;
      }

      const lastServiceDate = parseDate(raw.lastServiceDate);
      if ((raw.lastServiceDate || "").trim() && !lastServiceDate) {
        warnings.push(`Could not parse lastServiceDate "${(raw.lastServiceDate || "").trim()}" — imported without it`);
      }
      const lastServiceMileage = parseIntOrNull(raw.lastServiceMileage);
      if ((raw.lastServiceMileage || "").trim() && lastServiceMileage === null) {
        warnings.push(`Could not parse lastServiceMileage "${(raw.lastServiceMileage || "").trim()}" — imported without it`);
      }

      const key = scheduleMatchKey(vehicleId, serviceType);
      if (seenInBatch.has(key)) {
        results.push({
          row: rowNumber,
          status: "skipped",
          message: `Duplicate row in file: "${serviceType}" for ${plateRaw}`,
        });
        continue;
      }
      seenInBatch.add(key);

      const data = {
        vehicleId,
        serviceType,
        everyMonths,
        everyMiles,
        lastServiceDate,
        lastServiceMileage,
        notes: (raw.notes || "").trim() || null,
      };

      const existing = existingByKey.get(key);
      const action = applyMode(existing, ctx.mode);
      const label = `Schedule "${serviceType}" for ${plateRaw}`;

      try {
        if (action === "update" && existing) {
          let updateData: Partial<typeof data> = data;
          if (ctx.mode === "fill-blanks") {
            const current = await db.vehicleServiceSchedule.findUnique({
              where: { id: existing.id },
            });
            updateData = mergeFillBlanks(current, data);
          }
          const schedule = await db.vehicleServiceSchedule.update({
            where: { id: existing.id },
            data: updateData,
          });
          results.push({ row: rowNumber, status: "updated", warnings: warnList(warnings) });
          await logImportActivity(ctx, "imported", "vehicleServiceSchedule", schedule.id, `${label} (updated)`);
        } else if (action === "skip") {
          results.push({
            row: rowNumber,
            status: "skipped",
            message: existing ? skipExistsMessage(label) : skipNoMatchMessage(label),
          });
        } else {
          const schedule = await db.vehicleServiceSchedule.create({ data });
          existingByKey.set(key, { id: schedule.id });
          results.push({ row: rowNumber, status: "imported", warnings: warnList(warnings) });
          await logImportActivity(ctx, "imported", "vehicleServiceSchedule", schedule.id, label);
        }
      } catch (err) {
        results.push({
          row: rowNumber,
          status: "failed",
          message: err instanceof Error ? err.message : "DB error",
        });
      }
    }

    return buildResult(results);
  },
};
