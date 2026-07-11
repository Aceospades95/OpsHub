import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock @/lib/db so the module-level import (sampleRows/exportRows)
// doesn't instantiate a real PrismaClient; commit() uses ctx.db.
vi.mock("@/lib/db", () => ({
  db: {
    user: { findMany: vi.fn() },
    vehicle: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    activityLog: { create: vi.fn() },
  },
}));

import { db } from "@/lib/db";
import { vehiclesImporter, normalizePlate } from "./vehicles";
import type { ImportContext, ImportMode } from "../types";

const userFindMany = db.user.findMany as ReturnType<typeof vi.fn>;
const vehicleFindMany = db.vehicle.findMany as ReturnType<typeof vi.fn>;
const vehicleCreate = db.vehicle.create as ReturnType<typeof vi.fn>;
const vehicleUpdate = db.vehicle.update as ReturnType<typeof vi.fn>;
const activityCreate = db.activityLog.create as ReturnType<typeof vi.fn>;

function mkCtx(mode: ImportMode): ImportContext {
  return {
    triggeredBy: "admin-1",
    mode,
    db: db as unknown as ImportContext["db"],
  };
}

describe("normalizePlate", () => {
  it("strips whitespace and uppercases", () => {
    expect(normalizePlate(" ab 12 cd ")).toBe("AB12CD");
    expect(normalizePlate("AB12CD")).toBe("AB12CD");
  });
});

describe("vehicles importer commit()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    userFindMany.mockResolvedValue([
      { id: "u1", email: "driver@example.com", name: "Dan Driver" },
    ]);
    vehicleCreate.mockImplementation(async ({ data }) => ({ id: "v-new", ...data }));
    vehicleUpdate.mockImplementation(async ({ where, data }) => ({ ...where, ...data }));
  });

  it("happy path: creates a vehicle, resolves the driver, maps the status", async () => {
    vehicleFindMany.mockResolvedValue([]);

    const result = await vehiclesImporter.commit(
      [
        {
          make: "Ford",
          model: "Transit",
          year: "2022",
          licensePlate: "AB 12 CD",
          vin: "1FTBW2CM0NKA00001",
          status: "Active",
          driverEmail: "driver@example.com",
          currentMileage: "48,120",
          registrationExpires: "2026-11-30",
          notes: "Roof rack",
        },
      ],
      mkCtx("upsert")
    );

    expect(result.imported).toBe(1);
    expect(result.failed).toBe(0);
    expect(result.warnings).toBe(0);
    expect(vehicleCreate).toHaveBeenCalledOnce();
    const data = vehicleCreate.mock.calls[0][0].data;
    expect(data).toMatchObject({
      make: "Ford",
      model: "Transit",
      year: 2022,
      licensePlate: "AB 12 CD",
      vin: "1FTBW2CM0NKA00001",
      status: "ACTIVE",
      assignedToId: "u1",
      currentMileage: 48120,
    });
    expect(data.registrationExpiresAt).toBeInstanceOf(Date);
    expect(data.mileageUpdatedAt).toBeInstanceOf(Date);
    expect(activityCreate).toHaveBeenCalledOnce();
  });

  it("matches an existing vehicle by normalized plate and updates in upsert mode", async () => {
    vehicleFindMany.mockResolvedValue([
      { id: "v1", licensePlate: "AB12CD", vin: null, deletedAt: null },
    ]);

    const result = await vehiclesImporter.commit(
      [{ make: "Ford", model: "Transit", year: "2022", licensePlate: "ab 12 cd" }],
      mkCtx("upsert")
    );

    expect(result.updated).toBe(1);
    expect(vehicleUpdate).toHaveBeenCalledOnce();
    expect(vehicleUpdate.mock.calls[0][0].where).toEqual({ id: "v1" });
    expect(vehicleCreate).not.toHaveBeenCalled();
  });

  it("create mode skips a plate match; update mode skips a non-match", async () => {
    vehicleFindMany.mockResolvedValue([
      { id: "v1", licensePlate: "AB12CD", vin: null, deletedAt: null },
    ]);

    const createRun = await vehiclesImporter.commit(
      [{ make: "Ford", model: "Transit", year: "2022", licensePlate: "AB12CD" }],
      mkCtx("create")
    );
    expect(createRun.skipped).toBe(1);
    expect(createRun.rows[0].message).toContain("already exists");

    const updateRun = await vehiclesImporter.commit(
      [{ make: "Ram", model: "ProMaster", year: "2021", licensePlate: "ZZ99ZZ" }],
      mkCtx("update")
    );
    expect(updateRun.skipped).toBe(1);
    expect(updateRun.rows[0].message).toContain("no existing record");
    expect(vehicleCreate).not.toHaveBeenCalled();
    expect(vehicleUpdate).not.toHaveBeenCalled();
  });

  it("warns (but still imports) on unresolved driver, unknown status, and project column", async () => {
    vehicleFindMany.mockResolvedValue([]);

    const result = await vehiclesImporter.commit(
      [
        {
          make: "Nissan",
          model: "NV3500",
          year: "2016",
          licensePlate: "XY 99 ZW",
          status: "Scrapyard",
          driverName: "Nobody Known",
          project: "Site 12 build-out",
        },
      ],
      mkCtx("upsert")
    );

    expect(result.imported).toBe(1);
    expect(result.warnings).toBe(1);
    const warnings = result.rows[0].warnings ?? [];
    expect(warnings.join(" ")).toContain("Unknown status");
    expect(warnings.join(" ")).toContain("Driver not found by name");
    expect(warnings.join(" ")).toContain("don't link to projects");
    // Unknown status coerces to the default.
    expect(vehicleCreate.mock.calls[0][0].data.status).toBe("ACTIVE");
    expect(vehicleCreate.mock.calls[0][0].data.assignedToId).toBeNull();
  });

  it("fails a row with neither plate nor VIN", async () => {
    vehicleFindMany.mockResolvedValue([]);

    const result = await vehiclesImporter.commit(
      [{ make: "Ford", model: "F-150", year: "2020" }],
      mkCtx("upsert")
    );

    expect(result.failed).toBe(1);
    expect(result.rows[0].message).toContain("licensePlate");
    expect(vehicleCreate).not.toHaveBeenCalled();
  });
});
