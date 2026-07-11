/**
 * Vehicle maintenance importer — bulk-create maintenance history rows
 * from the fleet spreadsheet's service log.
 *
 * Required: licensePlate (must resolve to an existing vehicle — hard
 * fail otherwise), serviceDate, serviceType.
 * Optional: odometer (accepts "mileage" headers), cost (accepts
 * "$1,234.56"; "NA"/"N/A" → empty), vendor, notes, driverName.
 *
 * The VehicleMaintenanceRecord model has no driver field, so a
 * driverName value is appended into notes as "Driver: X".
 *
 * Match/dedupe key: (vehicle + serviceDate + serviceType) — an exact
 * duplicate is skipped in create mode and updated in update/upsert
 * modes, so re-uploading the same service log is idempotent.
 *
 * Side effects when a record is CREATED (never in preview-visible
 * scope beyond ctx.db, and never on plain updates):
 *   - a matching VehicleServiceSchedule (vehicle + serviceType,
 *     case-insensitive) with an older-or-null lastServiceDate is
 *     re-armed: lastServiceDate ← serviceDate, lastServiceMileage ←
 *     odometer (when supplied);
 *   - an odometer above the vehicle's currentMileage (or a vehicle
 *     with no reading yet) updates Vehicle.currentMileage +
 *     mileageUpdatedAt (stamped with the serviceDate — the reading is
 *     as-of the service, not the import).
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

function maintenanceMatchKey(
  vehicleId: string,
  serviceDate: Date,
  serviceType: string
): string {
  return `${vehicleId}|${serviceDate.toISOString().slice(0, 10)}|${serviceType.trim().toLowerCase()}`;
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

/**
 * Money parser for fleet spreadsheets: strips "$", ",", and spaces;
 * treats NA / N/A / none / "-" as intentional no-value (no warning).
 * Anything else unparseable comes back null WITH a warning flag.
 */
function parseCost(v: string | undefined): { value: number | null; invalid: boolean } {
  const s = (v || "").trim();
  if (!s) return { value: null, invalid: false };
  if (/^(na|n\/a|none|-+)$/i.test(s)) return { value: null, invalid: false };
  const n = parseFloat(s.replace(/[$,\s]/g, ""));
  if (!Number.isFinite(n)) return { value: null, invalid: true };
  return { value: n, invalid: false };
}

export const vehicleMaintenanceImporter: ImporterDefinition = {
  key: "vehicle-maintenance",
  name: "Vehicle Maintenance Records",
  description:
    "Bulk-create vehicle maintenance history. Required: licensePlate (existing vehicle), serviceDate, serviceType. Optional: odometer, cost, vendor, notes, driver name. Also re-arms matching service schedules and rolls the vehicle's odometer forward.",
  module: "fleet",
  supportsUpsert: true,
  upsertKeyDescription:
    "Matched by (vehicle license plate + service date + service type). Exact duplicates are skipped in create mode; re-uploads update the matched record in update modes.",

  fields: [
    {
      key: "licensePlate",
      label: "License plate",
      required: true,
      description: "Plate of an existing vehicle (whitespace/case ignored). Rows with an unknown plate fail — import vehicles first.",
      aliases: ["plate", "vehicle", "vehicle plate", "tag"],
    },
    {
      key: "serviceDate",
      label: "Service date",
      required: true,
      description: "ISO date (YYYY-MM-DD) the service was performed.",
      aliases: ["date", "date of service", "serviced on"],
    },
    {
      key: "serviceType",
      label: "Service type",
      required: true,
      description: "\"Oil change\", \"Brake pads\", … Matches VehicleServiceSchedule.serviceType to re-arm schedules.",
      aliases: ["service", "type", "work performed"],
    },
    {
      key: "odometer",
      label: "Odometer",
      required: false,
      description: "Odometer reading at service time (miles). Commas are OK.",
      aliases: ["mileage", "miles", "odometer reading"],
    },
    {
      key: "cost",
      label: "Cost",
      required: false,
      description: "Service cost. Accepts \"$1,234.56\"; NA / N/A means no cost recorded.",
      aliases: ["price", "amount", "total"],
    },
    { key: "vendor", label: "Vendor", required: false, description: "Shop / vendor that performed the work.", aliases: ["shop", "supplier", "performed by"] },
    { key: "notes", label: "Notes", required: false, aliases: ["comments", "description", "details"] },
    {
      key: "driverName",
      label: "Driver name",
      required: false,
      description: "Driver at service time. The record has no driver field, so this is appended to notes as \"Driver: X\".",
      aliases: ["driver", "driven by"],
    },
  ],

  async sampleRows() {
    const records = await db.vehicleMaintenanceRecord.findMany({
      orderBy: { serviceDate: "desc" },
      take: 3,
      include: { vehicle: { select: { licensePlate: true } } },
    });
    return records.map((r) => ({
      licensePlate: r.vehicle.licensePlate || "",
      serviceDate: formatDate(r.serviceDate),
      serviceType: r.serviceType,
      odometer: r.odometer != null ? String(r.odometer) : "",
      cost: r.cost != null ? String(r.cost) : "",
      vendor: r.vendor || "",
      notes: r.notes || "",
      driverName: "",
    }));
  },

  async exportRows() {
    const records = await db.vehicleMaintenanceRecord.findMany({
      orderBy: [{ vehicleId: "asc" }, { serviceDate: "desc" }],
      include: { vehicle: { select: { licensePlate: true, deletedAt: true } } },
    });
    return records
      .filter((r) => r.vehicle.deletedAt === null)
      .map((r) => ({
        licensePlate: r.vehicle.licensePlate || "",
        serviceDate: formatDate(r.serviceDate),
        serviceType: r.serviceType,
        odometer: r.odometer != null ? String(r.odometer) : "",
        cost: r.cost != null ? String(r.cost) : "",
        vendor: r.vendor || "",
        notes: r.notes || "",
        driverName: "",
      }));
  },

  async commit(rows, ctx) {
    const db = ctx.db; // ALL commit reads/writes go through ctx.db
    const results: ImportRowResult[] = [];

    // Vehicles by normalized plate, carrying currentMileage so the
    // roll-forward comparison works without a query per row. The map
    // value mutates as rows land so later rows in the same file
    // compare against the freshest reading.
    const vehicles = await db.vehicle.findMany({
      where: { deletedAt: null },
      select: { id: true, licensePlate: true, currentMileage: true },
    });
    const vehicleByPlate = new Map(
      vehicles
        .filter((v): v is typeof v & { licensePlate: string } => Boolean(v.licensePlate))
        .map((v) => [normalizePlate(v.licensePlate), { id: v.id, currentMileage: v.currentMileage }])
    );

    // Service schedules for the re-arm side effect, keyed by
    // (vehicleId + lowercased serviceType). lastServiceDate mutates
    // in-memory as records land.
    const schedules = await db.vehicleServiceSchedule.findMany({
      select: { id: true, vehicleId: true, serviceType: true, lastServiceDate: true },
    });
    const scheduleByKey = new Map(
      schedules.map((s) => [
        `${s.vehicleId}|${s.serviceType.trim().toLowerCase()}`,
        { id: s.id, lastServiceDate: s.lastServiceDate as Date | null },
      ])
    );

    // Existing records for dedupe/matching.
    const existingRecords = await db.vehicleMaintenanceRecord.findMany({
      select: { id: true, vehicleId: true, serviceDate: true, serviceType: true },
    });
    const existingByKey = new Map<string, { id: string }>(
      existingRecords.map((r) => [
        maintenanceMatchKey(r.vehicleId, r.serviceDate, r.serviceType),
        { id: r.id },
      ])
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
      const serviceDate = parseDate(raw.serviceDate);
      if (!serviceDate) {
        results.push({
          row: rowNumber,
          status: "failed",
          message: (raw.serviceDate || "").trim()
            ? `Invalid serviceDate "${(raw.serviceDate || "").trim()}" — expected YYYY-MM-DD`
            : "Missing serviceDate",
        });
        continue;
      }
      if (!serviceType) {
        results.push({ row: rowNumber, status: "failed", message: "Missing serviceType" });
        continue;
      }

      const vehicle = vehicleByPlate.get(normalizePlate(plateRaw));
      if (!vehicle) {
        results.push({
          row: rowNumber,
          status: "failed",
          message: `Vehicle not found for plate "${plateRaw}" — import vehicles first`,
        });
        continue;
      }

      const odometer = parseIntOrNull(raw.odometer);
      if ((raw.odometer || "").trim() && odometer === null) {
        warnings.push(`Could not parse odometer "${(raw.odometer || "").trim()}" — imported without it`);
      }
      const { value: cost, invalid: costInvalid } = parseCost(raw.cost);
      if (costInvalid) {
        warnings.push(`Could not parse cost "${(raw.cost || "").trim()}" — imported without a cost`);
      }

      // No driver field on the model — fold the name into notes.
      const driverName = (raw.driverName || "").trim();
      const notesBase = (raw.notes || "").trim();
      const notes =
        [notesBase, driverName ? `Driver: ${driverName}` : ""]
          .filter(Boolean)
          .join("\n") || null;

      const key = maintenanceMatchKey(vehicle.id, serviceDate, serviceType);
      if (seenInBatch.has(key)) {
        results.push({
          row: rowNumber,
          status: "skipped",
          message: `Duplicate row in file: "${serviceType}" on ${formatDate(serviceDate)} for ${plateRaw}`,
        });
        continue;
      }
      seenInBatch.add(key);

      const data = {
        vehicleId: vehicle.id,
        serviceDate,
        serviceType,
        odometer,
        cost,
        vendor: (raw.vendor || "").trim() || null,
        notes,
      };

      const existing = existingByKey.get(key);
      const action = applyMode(existing, ctx.mode);
      const label = `${serviceType} on ${formatDate(serviceDate)} for ${plateRaw}`;

      try {
        if (action === "update" && existing) {
          let updateData: Partial<typeof data> = data;
          if (ctx.mode === "fill-blanks") {
            const current = await db.vehicleMaintenanceRecord.findUnique({
              where: { id: existing.id },
            });
            updateData = mergeFillBlanks(current, data);
          }
          const record = await db.vehicleMaintenanceRecord.update({
            where: { id: existing.id },
            data: updateData,
          });
          results.push({ row: rowNumber, status: "updated", warnings: warnList(warnings) });
          await logImportActivity(ctx, "imported", "vehicleMaintenanceRecord", record.id, `${label} (updated)`);
        } else if (action === "skip") {
          const skipLabel = `Maintenance record "${serviceType}" on ${formatDate(serviceDate)} for ${plateRaw}`;
          results.push({
            row: rowNumber,
            status: "skipped",
            message: existing ? skipExistsMessage(skipLabel) : skipNoMatchMessage(skipLabel),
          });
        } else {
          const record = await db.vehicleMaintenanceRecord.create({ data });
          existingByKey.set(key, { id: record.id });

          // Side effect 1: re-arm the matching service schedule when
          // this record is newer than its lastServiceDate (or the
          // schedule has never been serviced).
          const schedule = scheduleByKey.get(`${vehicle.id}|${serviceType.toLowerCase()}`);
          if (
            schedule &&
            (schedule.lastServiceDate === null || schedule.lastServiceDate < serviceDate)
          ) {
            await db.vehicleServiceSchedule.update({
              where: { id: schedule.id },
              data: {
                lastServiceDate: serviceDate,
                // Only overwrite the mileage when this record has one —
                // wiping a known reading with null loses data.
                ...(odometer !== null ? { lastServiceMileage: odometer } : {}),
              },
            });
            schedule.lastServiceDate = serviceDate;
          }

          // Side effect 2: roll the vehicle's odometer forward.
          // mileageUpdatedAt is stamped with the SERVICE date — the
          // reading is as-of the service, not the import — so the
          // staleness signal stays honest for historical backfills.
          if (
            odometer !== null &&
            (vehicle.currentMileage === null || odometer > vehicle.currentMileage)
          ) {
            await db.vehicle.update({
              where: { id: vehicle.id },
              data: { currentMileage: odometer, mileageUpdatedAt: serviceDate },
            });
            vehicle.currentMileage = odometer;
          }

          results.push({ row: rowNumber, status: "imported", warnings: warnList(warnings) });
          await logImportActivity(ctx, "imported", "vehicleMaintenanceRecord", record.id, label);
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
