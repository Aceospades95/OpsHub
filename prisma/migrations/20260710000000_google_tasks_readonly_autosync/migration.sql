-- Google Tasks: read-only tasks (assigned / Gmail-linked), source link, auto-sync cadence.

-- AlterTable
ALTER TABLE "Task" ADD COLUMN "sourceLink" TEXT;
ALTER TABLE "Task" ADD COLUMN "sourceReadOnly" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "GoogleTasksIntegration" ADD COLUMN "autoSyncMinutes" INTEGER;
