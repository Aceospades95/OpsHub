-- Admin customization of built-in reports (rename, describe, hide,
-- row cap, per-column label/hide/order). Absence of a row = stock.
CREATE TABLE "ReportOverride" (
    "id" TEXT NOT NULL,
    "reportKey" TEXT NOT NULL,
    "displayName" TEXT,
    "description" TEXT,
    "hidden" BOOLEAN NOT NULL DEFAULT false,
    "maxRows" INTEGER,
    "columnConfig" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ReportOverride_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ReportOverride_reportKey_key" ON "ReportOverride"("reportKey");
