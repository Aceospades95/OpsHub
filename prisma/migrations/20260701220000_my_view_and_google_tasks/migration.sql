-- My View fields on Project: an internal owner ("whose plate is this on")
-- and free-form running notes editable inline from /my.

-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "ownerId" TEXT;
ALTER TABLE "Project" ADD COLUMN     "notes" TEXT;

-- CreateIndex
CREATE INDEX "Project_ownerId_idx" ON "Project"("ownerId");

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- SupplierProject.projectId was a bare string column with no FK since the
-- model shipped — hard-deleting a project (recovery-bin purge) orphaned
-- these rows and Project couldn't `include` its suppliers. Remove any
-- accumulated orphans, then add the missing constraint + index so the
-- join behaves like SubcontractorProject / PartnershipProject.
DELETE FROM "SupplierProject" WHERE "projectId" NOT IN (SELECT "id" FROM "Project");

-- CreateIndex
CREATE INDEX "SupplierProject_projectId_idx" ON "SupplierProject"("projectId");

-- AddForeignKey
ALTER TABLE "SupplierProject" ADD CONSTRAINT "SupplierProject_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Google Tasks integration: one row per connected user. See the model
-- comment in schema.prisma for why this is separate from the NextAuth
-- Account table.

-- CreateTable
CREATE TABLE "GoogleTasksIntegration" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "refreshToken" TEXT NOT NULL,
    "accessToken" TEXT,
    "accessTokenExpiresAt" TIMESTAMP(3),
    "tasklistId" TEXT,
    "lastSyncedAt" TIMESTAMP(3),
    "lastSyncStatus" TEXT,
    "lastSyncError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GoogleTasksIntegration_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GoogleTasksIntegration_userId_key" ON "GoogleTasksIntegration"("userId");

-- AddForeignKey
ALTER TABLE "GoogleTasksIntegration" ADD CONSTRAINT "GoogleTasksIntegration_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
