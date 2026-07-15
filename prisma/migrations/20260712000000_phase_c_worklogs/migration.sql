-- Phase C: work logs, schedule exceptions, notification prefs, vehicle files.
CREATE TYPE "ScheduleExceptionType" AS ENUM ('PTO', 'SICK', 'HOLIDAY', 'UNPAID', 'OTHER');

CREATE TABLE "WorkLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "workDate" TIMESTAMP(3) NOT NULL,
    "hours" DOUBLE PRECISION NOT NULL,
    "sites" TEXT,
    "notes" TEXT,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "WorkLog_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "WorkLog_userId_workDate_key" ON "WorkLog"("userId", "workDate");
CREATE INDEX "WorkLog_workDate_idx" ON "WorkLog"("workDate");
ALTER TABLE "WorkLog" ADD CONSTRAINT "WorkLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "ScheduleException" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "type" "ScheduleExceptionType" NOT NULL,
    "approved" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ScheduleException_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ScheduleException_userId_startDate_idx" ON "ScheduleException"("userId", "startDate");
CREATE INDEX "ScheduleException_startDate_idx" ON "ScheduleException"("startDate");
ALTER TABLE "ScheduleException" ADD CONSTRAINT "ScheduleException_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ScheduleException" ADD CONSTRAINT "ScheduleException_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "WorkLogWeekSnapshot" (
    "id" TEXT NOT NULL,
    "weekKey" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expectedDays" INTEGER NOT NULL,
    "submittedDays" INTEGER NOT NULL,
    "totalHours" DOUBLE PRECISION NOT NULL,
    "snapshotAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WorkLogWeekSnapshot_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "WorkLogWeekSnapshot_weekKey_userId_key" ON "WorkLogWeekSnapshot"("weekKey", "userId");
CREATE INDEX "WorkLogWeekSnapshot_weekKey_idx" ON "WorkLogWeekSnapshot"("weekKey");
ALTER TABLE "WorkLogWeekSnapshot" ADD CONSTRAINT "WorkLogWeekSnapshot_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "WorkWeekFlag" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "weekKey" TEXT NOT NULL,
    "overtimeApproved" BOOLEAN NOT NULL DEFAULT false,
    "approvedById" TEXT,
    "note" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "WorkWeekFlag_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "WorkWeekFlag_userId_weekKey_key" ON "WorkWeekFlag"("userId", "weekKey");
CREATE INDEX "WorkWeekFlag_weekKey_idx" ON "WorkWeekFlag"("weekKey");
ALTER TABLE "WorkWeekFlag" ADD CONSTRAINT "WorkWeekFlag_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WorkWeekFlag" ADD CONSTRAINT "WorkWeekFlag_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "UserNotificationPref" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "typeKey" TEXT NOT NULL,
    "muteInApp" BOOLEAN NOT NULL DEFAULT false,
    "muteEmail" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "UserNotificationPref_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "UserNotificationPref_userId_typeKey_key" ON "UserNotificationPref"("userId", "typeKey");
ALTER TABLE "UserNotificationPref" ADD CONSTRAINT "UserNotificationPref_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Vehicle attachments (maintenance receipts/photos, registration docs).
ALTER TABLE "File" ADD COLUMN "vehicleId" TEXT;
CREATE INDEX "File_vehicleId_category_idx" ON "File"("vehicleId", "category");
ALTER TABLE "File" ADD CONSTRAINT "File_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE CASCADE ON UPDATE CASCADE;
