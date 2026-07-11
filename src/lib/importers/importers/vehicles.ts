/**
 * Vehicles importer — bulk-create or update fleet vehicles from CSV.
 *
 * Required: make, model, year, and at least one of licensePlate / vin
 * (the natural keys — a vehicle with neither can never be matched on
 * re-upload, so the row fails with a clear message).
 *
 * Optional: nickname, status, driverEmail / driverName (resolved to an
 * existing user → assignedTo, warning when unresolved), project
 * (accepted for legacy fleet spreadsheets but WARNING-only — vehicles
 * don't link to projects; the value is not stored), registrationExpires,
 * currentMileage, notes.
 *
 * Match key: normalized license plate first (whitespace stripped,
 * uppercased), then VIN (trimmed, uppercased). Soft-deleted vehicles
 * are not update targets, but a VIN that collides with a soft-deleted
 * vehicle fails the row (the DB unique constraint spans tombstones).
 */

import type { VehicleStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { vehicleLabel } from "@/lib/fleet";
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

/** Plate normalization for matching: strip ALL whitespace, uppercase. */
export function normalizePlate(raw: string): string {
  return raw.replace(/\s+/g, "").toUpperCase();
}

function normalizeVin(raw: string): string {
  return raw.trim().toUpperCase();
}

/**
 * Map common fleet-spreadsheet status labels onto the VehicleStatus
 * enum. Unknown non-empty values default to ACTIVE with a warning.
 */
function parseVehicleStatus(raw: string): { status: VehicleStatus; unknown: boolean } {
  const v = raw.trim().toUpperCase().replace(/[\s-]+/g, "_");
  if (!v) return { status: "ACTIVE", unknown: false };
  switch (v) {
    case "ACTIVE":
      return { status: "ACTIVE", unknown: false };
    case "IN_SHOP":
    case "SHOP":
    case "IN_SERVICE_SHOP":
    case "MAINTENANCE":
      return { status: "IN_SHOP", unknown: false };
    case "RETIRED":
    case "INACTIVE":
      return { status: "RETIRED", unknown: false };
    case "SOLD":
      return { status: "SOLD", unknown: false };
    default:
      return { status: "ACTIVE", unknown: true };
  }
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

export const vehiclesImporter: ImporterDefinition = {
  key: "vehicles",
  name: "Vehicles",
  description:
    "Bulk-create or update fleet vehicles. Required: make, model, year, and a license plate or VIN. Optional: nickname, status, driver (by email or name), registration expiry, current mileage, notes.",
  module: "fleet",
  supportsUpsert: true,
  upsertKeyDescription:
    "Matched by license plate (whitespace/case-insensitive) first, then VIN. Re-uploading the same plate or VIN updates the existing vehicle.",

  fields: [
    { key: "make", label: "Make", required: true, description: "Manufacturer, e.g. Ford.", aliases: ["manufacturer", "brand"] },
    { key: "model", label: "Model", required: true, description: "Model name, e.g. Transit.", aliases: ["vehicle model"] },
    { key: "year", label: "Year", required: true, description: "Model year, e.g. 2022.", aliases: ["model year", "yr"] },
    {
      key: "licensePlate",
      label: "License plate",
      required: false,
      description: "Primary match key. Whitespace and case are ignored for matching. Required when no VIN is given.",
      aliases: ["plate", "license", "plate number", "tag"],
    },
    {
      key: "vin",
      label: "VIN",
      required: false,
      description: "Vehicle identification number. Fallback match key when there's no plate.",
      aliases: ["vin number", "serial"],
    },
    {
      key: "nickname",
      label: "Nickname",
      required: false,
      description: "Optional friendly label, e.g. \"Van #3\". Lists fall back to year + make + model.",
      aliases: ["label", "vehicle name", "name"],
    },
    {
      key: "status",
      label: "Status",
      required: false,
      description: "ACTIVE, IN_SHOP, RETIRED (also accepts Inactive), or SOLD. Defaults to ACTIVE.",
      aliases: ["vehicle status", "state"],
    },
    {
      key: "driverEmail",
      label: "Driver email",
      required: false,
      description: "Email of the assigned driver (an existing employee). Takes precedence over driver name.",
      aliases: ["assigned to email", "driver e-mail"],
    },
    {
      key: "driverName",
      label: "Driver name",
      required: false,
      description: "Full name of the assigned driver — used when no driver email column exists. Must match exactly one employee.",
      aliases: ["driver", "assigned to", "assigned driver"],
    },
    {
      key: "project",
      label: "Project (informational)",
      required: false,
      description: "Accepted from legacy fleet sheets but NOT stored — vehicles don't link to projects. A warning is recorded so the value isn't dropped silently.",
      aliases: ["project name", "job"],
    },
    {
      key: "registrationExpires",
      label: "Registration expires",
      required: false,
      description: "ISO date (YYYY-MM-DD) the registration/plates expire.",
      aliases: ["registration", "registration expiry", "plates expire", "reg expires"],
    },
    {
      key: "currentMileage",
      label: "Current mileage",
      required: false,
      description: "Latest odometer reading (miles). Commas are OK (\"48,120\").",
      aliases: ["mileage", "odometer", "miles"],
    },
    { key: "notes", label: "Notes", required: false, aliases: ["comments", "description"] },
  ],

  async sampleRows() {
    const vehicles = await db.vehicle.findMany({
      where: { deletedAt: null },
      orderBy: { createdAt: "desc" },
      take: 3,
      include: { assignedTo: { select: { email: true, name: true } } },
    });
    return vehicles.map((v) => ({
      make: v.make,
      model: v.model,
      year: String(v.year),
      licensePlate: v.licensePlate || "",
      vin: v.vin || "",
      nickname: v.nickname || "",
      status: v.status,
      driverEmail: v.assignedTo?.email || "",
      driverName: v.assignedTo?.name || "",
      project: "",
      registrationExpires: formatDate(v.registrationExpiresAt),
      currentMileage: v.currentMileage != null ? String(v.currentMileage) : "",
      notes: v.notes || "",
    }));
  },

  async exportRows() {
    const vehicles = await db.vehicle.findMany({
      where: { deletedAt: null },
      orderBy: [{ status: "asc" }, { make: "asc" }, { model: "asc" }],
      include: { assignedTo: { select: { email: true, name: true } } },
    });
    return vehicles.map((v) => ({
      make: v.make,
      model: v.model,
      year: String(v.year),
      licensePlate: v.licensePlate || "",
      vin: v.vin || "",
      nickname: v.nickname || "",
      status: v.status,
      driverEmail: v.assignedTo?.email || "",
      driverName: v.assignedTo?.name || "",
      project: "",
      registrationExpires: formatDate(v.registrationExpiresAt),
      currentMileage: v.currentMileage != null ? String(v.currentMileage) : "",
      notes: v.notes || "",
    }));
  },

  async commit(rows, ctx) {
    const db = ctx.db; // ALL commit reads/writes go through ctx.db
    const results: ImportRowResult[] = [];

    // Users for driver resolution — email map + exact-name buckets
    // (a name shared by 2+ employees is ambiguous → warning).
    const users = await db.user.findMany({
      where: { isActive: true },
      select: { id: true, email: true, name: true },
    });
    const userByEmail = new Map(users.map((u) => [u.email.toLowerCase(), u.id]));
    const usersByName = new Map<string, string[]>();
    for (const u of users) {
      const key = u.name.trim().toLowerCase();
      usersByName.set(key, [...(usersByName.get(key) ?? []), u.id]);
    }

    // Every vehicle (including soft-deleted, for VIN-collision checks).
    const vehicles = await db.vehicle.findMany({
      select: { id: true, licensePlate: true, vin: true, deletedAt: true },
    });
    const byPlate = new Map<string, string>();
    const byVin = new Map<string, string>();
    const deletedVins = new Set<string>();
    for (const v of vehicles) {
      if (v.deletedAt) {
        if (v.vin) deletedVins.add(normalizeVin(v.vin));
        continue;
      }
      if (v.licensePlate) byPlate.set(normalizePlate(v.licensePlate), v.id);
      if (v.vin) byVin.set(normalizeVin(v.vin), v.id);
    }
    const seenInBatch = new Set<string>();

    for (let i = 0; i < rows.length; i++) {
      const rowNumber = i + 1;
      const raw = rows[i];
      const warnings: string[] = [];

      const make = (raw.make || "").trim();
      const model = (raw.model || "").trim();
      const yearRaw = (raw.year || "").trim();
      const plateRaw = (raw.licensePlate || "").trim();
      const vinRaw = (raw.vin || "").trim();

      if (!make) { results.push({ row: rowNumber, status: "failed", message: "Missing make" }); continue; }
      if (!model) { results.push({ row: rowNumber, status: "failed", message: "Missing model" }); continue; }
      const year = parseIntOrNull(yearRaw);
      if (!year || year < 1900 || year > 2100) {
        results.push({ row: rowNumber, status: "failed", message: `Invalid year "${yearRaw}" — expected e.g. 2022` });
        continue;
      }
      if (!plateRaw && !vinRaw) {
        results.push({
          row: rowNumber,
          status: "failed",
          message: "Missing both licensePlate and vin — at least one is required so the vehicle can be matched on re-upload",
        });
        continue;
      }

      const plateKey = plateRaw ? normalizePlate(plateRaw) : null;
      const vinKey = vinRaw ? normalizeVin(vinRaw) : null;

      const batchKey = plateKey ? `plate:${plateKey}` : `vin:${vinKey}`;
      if (seenInBatch.has(batchKey)) {
        results.push({
          row: rowNumber,
          status: "skipped",
          message: `Duplicate row in file: ${plateRaw || vinRaw}`,
        });
        continue;
      }
      seenInBatch.add(batchKey);

      // Status mapping — unknown labels default to ACTIVE with a warning.
      const { status, unknown: unknownStatus } = parseVehicleStatus(raw.status || "");
      if (unknownStatus) {
        warnings.push(`Unknown status "${(raw.status || "").trim()}" — defaulted to ACTIVE`);
      }

      // Driver: email wins, then exact (case-insensitive) name match.
      const driverEmail = (raw.driverEmail || "").trim().toLowerCase();
      const driverName = (raw.driverName || "").trim();
      let assignedToId: string | null = null;
      if (driverEmail) {
        assignedToId = userByEmail.get(driverEmail) || null;
        if (!assignedToId) {
          warnings.push(`Driver not found by email: "${(raw.driverEmail || "").trim()}" — imported without a driver`);
        }
      } else if (driverName) {
        const matches = usersByName.get(driverName.toLowerCase()) ?? [];
        if (matches.length === 1) {
          assignedToId = matches[0];
        } else if (matches.length > 1) {
          warnings.push(`Driver name "${driverName}" matches ${matches.length} employees — imported without a driver`);
        } else {
          warnings.push(`Driver not found by name: "${driverName}" — imported without a driver`);
        }
      }

      // Project is informational-only on vehicles.
      const project = (raw.project || "").trim();
      if (project) {
        warnings.push(`Project "${project}" noted in the CSV but vehicles don't link to projects — value not stored`);
      }

      const registrationExpiresAt = parseDate(raw.registrationExpires);
      if ((raw.registrationExpires || "").trim() && !registrationExpiresAt) {
        warnings.push(`Could not parse registration expiry "${(raw.registrationExpires || "").trim()}" — imported without it`);
      }

      const currentMileage = parseIntOrNull(raw.currentMileage);
      if ((raw.currentMileage || "").trim() && currentMileage === null) {
        warnings.push(`Could not parse mileage "${(raw.currentMileage || "").trim()}" — imported without it`);
      }

      // Match: plate first, then VIN.
      const existingId =
        (plateKey && byPlate.get(plateKey)) || (vinKey && byVin.get(vinKey)) || null;

      // Guard: creating with a VIN that belongs to a soft-deleted
      // vehicle would trip the unique constraint mid-run.
      if (!existingId && vinKey && deletedVins.has(vinKey)) {
        results.push({
          row: rowNumber,
          status: "failed",
          message: `VIN ${vinRaw} belongs to a deleted vehicle — restore it from the fleet page or clear the VIN column`,
        });
        continue;
      }

      const action = applyMode(existingId, ctx.mode);

      const data = {
        nickname: (raw.nickname || "").trim() || null,
        make,
        model,
        year,
        vin: vinRaw || null,
        licensePlate: plateRaw || null,
        status,
        assignedToId,
        currentMileage,
        // Only stamp the staleness marker when a reading was supplied.
        ...(currentMileage !== null ? { mileageUpdatedAt: new Date() } : {}),
        registrationExpiresAt,
        notes: (raw.notes || "").trim() || null,
      };

      const label = vehicleLabel({ nickname: data.nickname, year, make, model });

      try {
        if (action === "update" && existingId) {
          let updateData: Partial<typeof data> = data;
          if (ctx.mode === "fill-blanks") {
            const current = await db.vehicle.findUnique({ where: { id: existingId } });
            updateData = mergeFillBlanks(current, data);
            // mileageUpdatedAt rides with currentMileage — drop it when
            // the mileage itself didn't land.
            if (updateData.currentMileage === undefined) {
              delete updateData.mileageUpdatedAt;
            }
          }
          const vehicle = await db.vehicle.update({ where: { id: existingId }, data: updateData });
          results.push({ row: rowNumber, status: "updated", warnings: warnList(warnings) });
          await logImportActivity(ctx, "imported", "vehicle", vehicle.id, `${label} (updated)`);
        } else if (action === "skip") {
          const keyLabel = `Vehicle ${plateRaw || vinRaw}`;
          results.push({
            row: rowNumber,
            status: "skipped",
            message: existingId ? skipExistsMessage(keyLabel) : skipNoMatchMessage(keyLabel),
          });
        } else {
          const vehicle = await db.vehicle.create({ data });
          if (plateKey) byPlate.set(plateKey, vehicle.id);
          if (vinKey) byVin.set(vinKey, vehicle.id);
          results.push({ row: rowNumber, status: "imported", warnings: warnList(warnings) });
          await logImportActivity(ctx, "imported", "vehicle", vehicle.id, label);
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
