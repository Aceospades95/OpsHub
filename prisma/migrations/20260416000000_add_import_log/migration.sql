-- CreateTable
CREATE TABLE "ImportLog" (
    "id" TEXT NOT NULL,
    "importerKey" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "rowCount" INTEGER NOT NULL,
    "imported" INTEGER NOT NULL,
    "skipped" INTEGER NOT NULL,
    "errors" TEXT,
    "triggeredBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImportLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ImportLog_importerKey_createdAt_idx" ON "ImportLog"("importerKey", "createdAt");
CREATE INDEX "ImportLog_createdAt_idx" ON "ImportLog"("createdAt");
CREATE INDEX "ImportLog_triggeredBy_idx" ON "ImportLog"("triggeredBy");
