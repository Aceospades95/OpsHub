-- Soft-delete tombstone columns + the new PURGE_SOFT_DELETED scheduled
-- task type. Rows with deletedAt set are hidden from list / detail
-- views; /admin/recovery can restore (clear deletedAt) or
-- hard-delete; the scheduled task hard-deletes rows older than 30 days.

-- Major entities — 12 models the QA report identified for recovery
ALTER TABLE "Project"          ADD COLUMN "deletedAt" TIMESTAMP(3);
ALTER TABLE "Client"           ADD COLUMN "deletedAt" TIMESTAMP(3);
ALTER TABLE "Contract"         ADD COLUMN "deletedAt" TIMESTAMP(3);
ALTER TABLE "Quote"            ADD COLUMN "deletedAt" TIMESTAMP(3);
ALTER TABLE "Supplier"         ADD COLUMN "deletedAt" TIMESTAMP(3);
ALTER TABLE "Subcontractor"    ADD COLUMN "deletedAt" TIMESTAMP(3);
ALTER TABLE "Partnership"      ADD COLUMN "deletedAt" TIMESTAMP(3);
ALTER TABLE "Tool"             ADD COLUMN "deletedAt" TIMESTAMP(3);
ALTER TABLE "Certification"    ADD COLUMN "deletedAt" TIMESTAMP(3);
ALTER TABLE "IntranetResource" ADD COLUMN "deletedAt" TIMESTAMP(3);
ALTER TABLE "Document"         ADD COLUMN "deletedAt" TIMESTAMP(3);
ALTER TABLE "Task"             ADD COLUMN "deletedAt" TIMESTAMP(3);

-- Partial indexes on (deletedAt) for the recovery page lookup. Partial
-- because most rows are not soft-deleted; a partial index keeps the
-- happy-path list-page query (deletedAt IS NULL) using the existing
-- indexes, while making the recovery page query (deletedAt IS NOT NULL
-- ORDER BY deletedAt DESC) cheap.
CREATE INDEX "Project_deletedAt_idx"          ON "Project"("deletedAt")          WHERE "deletedAt" IS NOT NULL;
CREATE INDEX "Client_deletedAt_idx"           ON "Client"("deletedAt")           WHERE "deletedAt" IS NOT NULL;
CREATE INDEX "Contract_deletedAt_idx"         ON "Contract"("deletedAt")         WHERE "deletedAt" IS NOT NULL;
CREATE INDEX "Quote_deletedAt_idx"            ON "Quote"("deletedAt")            WHERE "deletedAt" IS NOT NULL;
CREATE INDEX "Supplier_deletedAt_idx"         ON "Supplier"("deletedAt")         WHERE "deletedAt" IS NOT NULL;
CREATE INDEX "Subcontractor_deletedAt_idx"    ON "Subcontractor"("deletedAt")    WHERE "deletedAt" IS NOT NULL;
CREATE INDEX "Partnership_deletedAt_idx"      ON "Partnership"("deletedAt")      WHERE "deletedAt" IS NOT NULL;
CREATE INDEX "Tool_deletedAt_idx"             ON "Tool"("deletedAt")             WHERE "deletedAt" IS NOT NULL;
CREATE INDEX "Certification_deletedAt_idx"    ON "Certification"("deletedAt")    WHERE "deletedAt" IS NOT NULL;
CREATE INDEX "IntranetResource_deletedAt_idx" ON "IntranetResource"("deletedAt") WHERE "deletedAt" IS NOT NULL;
CREATE INDEX "Document_deletedAt_idx"         ON "Document"("deletedAt")         WHERE "deletedAt" IS NOT NULL;
CREATE INDEX "Task_deletedAt_idx"             ON "Task"("deletedAt")             WHERE "deletedAt" IS NOT NULL;

-- New ScheduledTaskType for the cron that purges 30-day-old
-- soft-deletes. Existing tasks ('EMAIL_REPORT' only) are unaffected.
ALTER TYPE "ScheduledTaskType" ADD VALUE 'PURGE_SOFT_DELETED';
