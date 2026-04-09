-- CreateEnum
CREATE TYPE "AssignmentStatus" AS ENUM ('ACTIVE', 'PLANNED', 'COMPLETED', 'ON_HOLD');

-- CreateTable
CREATE TABLE "ServiceOffering" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServiceOffering_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Assignment" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "projectId" TEXT,
    "clientId" TEXT,
    "serviceOfferingId" TEXT,
    "function" TEXT,
    "role" TEXT,
    "allocationFte" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "status" "AssignmentStatus" NOT NULL DEFAULT 'ACTIVE',
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Assignment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ServiceOffering_name_key" ON "ServiceOffering"("name");

-- CreateIndex
CREATE INDEX "Assignment_employeeId_idx" ON "Assignment"("employeeId");

-- CreateIndex
CREATE INDEX "Assignment_projectId_idx" ON "Assignment"("projectId");

-- CreateIndex
CREATE INDEX "Assignment_clientId_idx" ON "Assignment"("clientId");

-- CreateIndex
CREATE INDEX "Assignment_serviceOfferingId_idx" ON "Assignment"("serviceOfferingId");

-- CreateIndex
CREATE INDEX "Assignment_status_idx" ON "Assignment"("status");

-- AddForeignKey
ALTER TABLE "Assignment" ADD CONSTRAINT "Assignment_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Assignment" ADD CONSTRAINT "Assignment_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Assignment" ADD CONSTRAINT "Assignment_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Assignment" ADD CONSTRAINT "Assignment_serviceOfferingId_fkey" FOREIGN KEY ("serviceOfferingId") REFERENCES "ServiceOffering"("id") ON DELETE SET NULL ON UPDATE CASCADE;
