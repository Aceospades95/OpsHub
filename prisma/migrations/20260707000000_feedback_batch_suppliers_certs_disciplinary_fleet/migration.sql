-- Feedback batch: supplier contacts + title, certification
-- renewal-submitted state, disciplinary action reports, vehicle fleet.

-- ── Supplier: primary-contact title ─────────────────────────────

-- AlterTable
ALTER TABLE "Supplier" ADD COLUMN     "contactTitle" TEXT;

-- ── Supplier contacts (AP dept, dispatch, extra emails/phones) ──

-- CreateTable
CREATE TABLE "SupplierContact" (
    "id" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "title" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupplierContact_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SupplierContact_supplierId_idx" ON "SupplierContact"("supplierId");

-- AddForeignKey
ALTER TABLE "SupplierContact" ADD CONSTRAINT "SupplierContact_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── Certification: renewal-submitted state ──────────────────────

-- AlterTable
ALTER TABLE "Certification" ADD COLUMN     "renewalSubmittedAt" TIMESTAMP(3);

-- ── Disciplinary action reports ─────────────────────────────────

-- CreateEnum
CREATE TYPE "DisciplinaryActionType" AS ENUM ('VERBAL_WARNING', 'WRITTEN_WARNING', 'FINAL_WARNING', 'SUSPENSION', 'TERMINATION', 'OTHER');

-- CreateTable
CREATE TABLE "DisciplinaryReport" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "issuedById" TEXT NOT NULL,
    "actionType" "DisciplinaryActionType" NOT NULL DEFAULT 'WRITTEN_WARNING',
    "incidentDate" TIMESTAMP(3) NOT NULL,
    "description" TEXT NOT NULL,
    "actionTaken" TEXT,
    "improvementPlan" TEXT,
    "witnesses" TEXT,
    "followUpDate" TIMESTAMP(3),
    "acknowledgedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "DisciplinaryReport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DisciplinaryReport_employeeId_incidentDate_idx" ON "DisciplinaryReport"("employeeId", "incidentDate");

-- AddForeignKey
ALTER TABLE "DisciplinaryReport" ADD CONSTRAINT "DisciplinaryReport_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DisciplinaryReport" ADD CONSTRAINT "DisciplinaryReport_issuedById_fkey" FOREIGN KEY ("issuedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── Vehicle fleet ────────────────────────────────────────────────

-- CreateEnum
CREATE TYPE "VehicleStatus" AS ENUM ('ACTIVE', 'IN_SHOP', 'RETIRED', 'SOLD');

-- CreateTable
CREATE TABLE "Vehicle" (
    "id" TEXT NOT NULL,
    "nickname" TEXT,
    "make" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "vin" TEXT,
    "licensePlate" TEXT,
    "status" "VehicleStatus" NOT NULL DEFAULT 'ACTIVE',
    "assignedToId" TEXT,
    "currentMileage" INTEGER,
    "nextServiceDate" TIMESTAMP(3),
    "nextServiceMileage" INTEGER,
    "maintenanceNotifiedFor" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Vehicle_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Vehicle_vin_key" ON "Vehicle"("vin");
CREATE INDEX "Vehicle_status_idx" ON "Vehicle"("status");
CREATE INDEX "Vehicle_assignedToId_idx" ON "Vehicle"("assignedToId");
CREATE INDEX "Vehicle_nextServiceDate_idx" ON "Vehicle"("nextServiceDate");

-- AddForeignKey
ALTER TABLE "Vehicle" ADD CONSTRAINT "Vehicle_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "VehicleMaintenanceRecord" (
    "id" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "serviceDate" TIMESTAMP(3) NOT NULL,
    "serviceType" TEXT NOT NULL,
    "odometer" INTEGER,
    "cost" DOUBLE PRECISION,
    "vendor" TEXT,
    "notes" TEXT,
    "nextDueDate" TIMESTAMP(3),
    "nextDueMileage" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VehicleMaintenanceRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "VehicleMaintenanceRecord_vehicleId_serviceDate_idx" ON "VehicleMaintenanceRecord"("vehicleId", "serviceDate");

-- AddForeignKey
ALTER TABLE "VehicleMaintenanceRecord" ADD CONSTRAINT "VehicleMaintenanceRecord_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE CASCADE ON UPDATE CASCADE;
