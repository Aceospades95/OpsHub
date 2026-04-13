-- AlterTable
ALTER TABLE "File" ADD COLUMN "storageDriver" TEXT;
ALTER TABLE "File" ADD COLUMN "storageKey" TEXT;
ALTER TABLE "File" ADD COLUMN "visibility" TEXT NOT NULL DEFAULT 'private';

-- CreateIndex
CREATE UNIQUE INDEX "File_storageKey_key" ON "File"("storageKey");
CREATE INDEX "File_storageDriver_idx" ON "File"("storageDriver");
CREATE INDEX "File_uploadedById_idx" ON "File"("uploadedById");
