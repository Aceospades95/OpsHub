-- CreateTable
CREATE TABLE "JobLog" (
    "id" TEXT NOT NULL,
    "jobKey" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "durationMs" INTEGER,
    "output" TEXT,
    "error" TEXT,
    "processed" INTEGER,
    "triggeredBy" TEXT NOT NULL,

    CONSTRAINT "JobLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "JobLog_jobKey_startedAt_idx" ON "JobLog"("jobKey", "startedAt");
CREATE INDEX "JobLog_startedAt_idx" ON "JobLog"("startedAt");
CREATE INDEX "JobLog_status_idx" ON "JobLog"("status");
