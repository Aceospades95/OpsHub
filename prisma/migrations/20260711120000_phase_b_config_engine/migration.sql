-- Phase B: configurability core.
-- 1. Notification rules — admin-editable per-type delivery config.
CREATE TABLE "NotificationRule" (
    "id" TEXT NOT NULL,
    "typeKey" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "channelInApp" BOOLEAN NOT NULL DEFAULT true,
    "channelEmail" BOOLEAN NOT NULL DEFAULT true,
    "recipientRoles" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "recipientUserIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "extraEmails" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "subjectTemplate" TEXT,
    "bodyTemplate" TEXT,
    "throttleHours" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "NotificationRule_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "NotificationRule_typeKey_key" ON "NotificationRule"("typeKey");

-- 2. Per-vehicle × service-type recurring schedules (months AND miles).
CREATE TABLE "VehicleServiceSchedule" (
    "id" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "serviceType" TEXT NOT NULL,
    "everyMonths" INTEGER,
    "everyMiles" INTEGER,
    "lastServiceDate" TIMESTAMP(3),
    "lastServiceMileage" INTEGER,
    "notifiedForDueAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "VehicleServiceSchedule_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "VehicleServiceSchedule_vehicleId_serviceType_key" ON "VehicleServiceSchedule"("vehicleId", "serviceType");
CREATE INDEX "VehicleServiceSchedule_vehicleId_idx" ON "VehicleServiceSchedule"("vehicleId");
ALTER TABLE "VehicleServiceSchedule" ADD CONSTRAINT "VehicleServiceSchedule_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Vehicle" ADD COLUMN "mileageUpdatedAt" TIMESTAMP(3);
ALTER TABLE "Vehicle" ADD COLUMN "registrationExpiresAt" TIMESTAMP(3);

-- 3. Import audit: explicit failed/warning counters.
ALTER TABLE "ImportLog" ADD COLUMN "failed" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "ImportLog" ADD COLUMN "warnings" INTEGER NOT NULL DEFAULT 0;

-- 4. Typed per-job parameters.
ALTER TABLE "JobConfig" ADD COLUMN "params" JSONB;
