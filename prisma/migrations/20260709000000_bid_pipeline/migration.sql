-- Bid pipeline: procurement-portal registry + bid opportunity tracking.

-- CreateEnum
CREATE TYPE "BidStatus" AS ENUM ('IDENTIFIED', 'PREPARING', 'SUBMITTED', 'WON', 'LOST', 'NO_BID', 'STALE');

-- CreateTable
CREATE TABLE "BidPortal" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT,
    "jurisdiction" TEXT,
    "accountIdentifier" TEXT,
    "registrationRenewsAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BidPortal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BidOpportunity" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "solicitationNumber" TEXT,
    "agency" TEXT,
    "url" TEXT,
    "description" TEXT,
    "estimatedValue" DOUBLE PRECISION,
    "currency" TEXT DEFAULT 'USD',
    "status" "BidStatus" NOT NULL DEFAULT 'IDENTIFIED',
    "dueDate" TIMESTAMP(3),
    "submittedAt" TIMESTAMP(3),
    "decidedAt" TIMESTAMP(3),
    "lossReason" TEXT,
    "notes" TEXT,
    "dueNotifiedFor" TIMESTAMP(3),
    "portalId" TEXT,
    "clientId" TEXT,
    "ownerId" TEXT,
    "projectId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "BidOpportunity_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BidOpportunity_status_idx" ON "BidOpportunity"("status");
CREATE INDEX "BidOpportunity_dueDate_idx" ON "BidOpportunity"("dueDate");
CREATE INDEX "BidOpportunity_portalId_idx" ON "BidOpportunity"("portalId");
CREATE INDEX "BidOpportunity_ownerId_idx" ON "BidOpportunity"("ownerId");
CREATE INDEX "BidOpportunity_clientId_idx" ON "BidOpportunity"("clientId");

-- AddForeignKey
ALTER TABLE "BidOpportunity" ADD CONSTRAINT "BidOpportunity_portalId_fkey" FOREIGN KEY ("portalId") REFERENCES "BidPortal"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "BidOpportunity" ADD CONSTRAINT "BidOpportunity_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "BidOpportunity" ADD CONSTRAINT "BidOpportunity_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "BidOpportunity" ADD CONSTRAINT "BidOpportunity_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;
