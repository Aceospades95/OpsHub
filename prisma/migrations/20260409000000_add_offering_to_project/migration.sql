-- AlterTable
ALTER TABLE "Project" ADD COLUMN "serviceOfferingId" TEXT;

-- CreateIndex
CREATE INDEX "Project_serviceOfferingId_idx" ON "Project"("serviceOfferingId");

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_serviceOfferingId_fkey" FOREIGN KEY ("serviceOfferingId") REFERENCES "ServiceOffering"("id") ON DELETE SET NULL ON UPDATE CASCADE;
