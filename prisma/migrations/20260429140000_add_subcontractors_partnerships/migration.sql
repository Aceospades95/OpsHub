-- Adds Subcontractors and Partnerships modules.
--
-- Subcontractors model external project labor (1099 individuals, sub
-- firms, agencies). Distinct from Supplier (vendor selling goods/services
-- TO the company) and User (internal employee). Includes per-project
-- engagement table SubcontractorProject for SOW / value / dates / rate
-- so the project page can roll up subcontractor cost.
--
-- Partnerships model strategic relationships (referrers, resellers,
-- channel/tech partners, joint ventures). PartnershipProject tags a
-- project with the partner's role (REFERRER, CO_DELIVERY, JOINT_OWNERSHIP,
-- etc.) plus an optional referralValue for revenue attribution.
--
-- File / ExternalLink / Comment gain optional subcontractorId +
-- partnershipId FKs so the polymorphic-attachment pattern keeps working.
-- CustomReportEntity gains SUBCONTRACTOR + PARTNERSHIP so admins can
-- build custom reports on the new entities.

-- ─── Enums ─────────────────────────────────────────────────

CREATE TYPE "SubcontractorStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'ONBOARDING', 'SUSPENDED', 'ARCHIVED');
CREATE TYPE "SubcontractorType" AS ENUM ('INDIVIDUAL', 'COMPANY', 'AGENCY');
CREATE TYPE "ComplianceStatus" AS ENUM ('COMPLIANT', 'PENDING', 'EXPIRED', 'NON_COMPLIANT');
CREATE TYPE "SubcontractorAssignmentStatus" AS ENUM ('ACTIVE', 'PLANNED', 'COMPLETED', 'ON_HOLD', 'TERMINATED');
CREATE TYPE "PartnershipStatus" AS ENUM ('ACTIVE', 'PROSPECT', 'INACTIVE', 'PAUSED', 'ARCHIVED');
CREATE TYPE "PartnershipType" AS ENUM ('STRATEGIC', 'REFERRAL', 'RESELLER', 'TECHNOLOGY', 'CHANNEL', 'JOINT_VENTURE', 'AFFILIATE', 'OTHER');
CREATE TYPE "PartnershipTier" AS ENUM ('PLATINUM', 'GOLD', 'SILVER', 'BRONZE', 'STANDARD');
CREATE TYPE "PartnershipProjectRole" AS ENUM ('REFERRER', 'CO_DELIVERY', 'JOINT_OWNERSHIP', 'RESELLER', 'INTEGRATION', 'SUBCONTRACTED', 'OTHER');

ALTER TYPE "CustomReportEntity" ADD VALUE 'SUBCONTRACTOR';
ALTER TYPE "CustomReportEntity" ADD VALUE 'PARTNERSHIP';

-- ─── Subcontractor ─────────────────────────────────────────

CREATE TABLE "Subcontractor" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "legalName" TEXT,
    "type" "SubcontractorType" NOT NULL DEFAULT 'COMPANY',
    "status" "SubcontractorStatus" NOT NULL DEFAULT 'ACTIVE',
    "description" TEXT,
    "summary" TEXT,
    "specialties" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "primaryContactName" TEXT,
    "primaryContactEmail" TEXT,
    "primaryContactPhone" TEXT,
    "website" TEXT,
    "address" TEXT,
    "taxId" TEXT,
    "businessLicense" TEXT,
    "defaultRate" DOUBLE PRECISION,
    "rateUnit" TEXT,
    "currency" TEXT DEFAULT 'USD',
    "paymentTerms" TEXT,
    "insuranceExpiresAt" TIMESTAMP(3),
    "w9OnFile" BOOLEAN NOT NULL DEFAULT false,
    "msaSignedAt" TIMESTAMP(3),
    "ndaSignedAt" TIMESTAMP(3),
    "complianceStatus" "ComplianceStatus" NOT NULL DEFAULT 'PENDING',
    "complianceNotes" TEXT,
    "rating" DOUBLE PRECISION,
    "isPreferred" BOOLEAN NOT NULL DEFAULT false,
    "accountManagerId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Subcontractor_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Subcontractor_status_idx" ON "Subcontractor"("status");
CREATE INDEX "Subcontractor_type_idx" ON "Subcontractor"("type");
CREATE INDEX "Subcontractor_accountManagerId_idx" ON "Subcontractor"("accountManagerId");
CREATE INDEX "Subcontractor_isPreferred_idx" ON "Subcontractor"("isPreferred");
CREATE INDEX "Subcontractor_complianceStatus_idx" ON "Subcontractor"("complianceStatus");
CREATE INDEX "Subcontractor_insuranceExpiresAt_idx" ON "Subcontractor"("insuranceExpiresAt");

ALTER TABLE "Subcontractor" ADD CONSTRAINT "Subcontractor_accountManagerId_fkey"
    FOREIGN KEY ("accountManagerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "SubcontractorContact" (
    "id" TEXT NOT NULL,
    "subcontractorId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "title" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SubcontractorContact_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SubcontractorContact_subcontractorId_idx" ON "SubcontractorContact"("subcontractorId");

ALTER TABLE "SubcontractorContact" ADD CONSTRAINT "SubcontractorContact_subcontractorId_fkey"
    FOREIGN KEY ("subcontractorId") REFERENCES "Subcontractor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "SubcontractorProject" (
    "id" TEXT NOT NULL,
    "subcontractorId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "scope" TEXT,
    "role" TEXT,
    "status" "SubcontractorAssignmentStatus" NOT NULL DEFAULT 'ACTIVE',
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "contractValue" DOUBLE PRECISION,
    "currency" TEXT DEFAULT 'USD',
    "rate" DOUBLE PRECISION,
    "rateUnit" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SubcontractorProject_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SubcontractorProject_subcontractorId_projectId_key" ON "SubcontractorProject"("subcontractorId", "projectId");
CREATE INDEX "SubcontractorProject_projectId_idx" ON "SubcontractorProject"("projectId");
CREATE INDEX "SubcontractorProject_status_idx" ON "SubcontractorProject"("status");

ALTER TABLE "SubcontractorProject" ADD CONSTRAINT "SubcontractorProject_subcontractorId_fkey"
    FOREIGN KEY ("subcontractorId") REFERENCES "Subcontractor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SubcontractorProject" ADD CONSTRAINT "SubcontractorProject_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─── Partnership ───────────────────────────────────────────

CREATE TABLE "Partnership" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "legalName" TEXT,
    "type" "PartnershipType" NOT NULL DEFAULT 'STRATEGIC',
    "status" "PartnershipStatus" NOT NULL DEFAULT 'ACTIVE',
    "tier" "PartnershipTier",
    "description" TEXT,
    "summary" TEXT,
    "primaryContactName" TEXT,
    "primaryContactEmail" TEXT,
    "primaryContactPhone" TEXT,
    "website" TEXT,
    "address" TEXT,
    "industry" TEXT,
    "partnerSinceDate" TIMESTAMP(3),
    "agreementSignedAt" TIMESTAMP(3),
    "agreementExpiresAt" TIMESTAMP(3),
    "autoRenew" BOOLEAN NOT NULL DEFAULT false,
    "revenueShareTerms" TEXT,
    "referralFeeBps" INTEGER,
    "jointMarketing" BOOLEAN NOT NULL DEFAULT false,
    "relationshipOwnerId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Partnership_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Partnership_status_idx" ON "Partnership"("status");
CREATE INDEX "Partnership_type_idx" ON "Partnership"("type");
CREATE INDEX "Partnership_tier_idx" ON "Partnership"("tier");
CREATE INDEX "Partnership_relationshipOwnerId_idx" ON "Partnership"("relationshipOwnerId");
CREATE INDEX "Partnership_agreementExpiresAt_idx" ON "Partnership"("agreementExpiresAt");

ALTER TABLE "Partnership" ADD CONSTRAINT "Partnership_relationshipOwnerId_fkey"
    FOREIGN KEY ("relationshipOwnerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "PartnershipContact" (
    "id" TEXT NOT NULL,
    "partnershipId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "title" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PartnershipContact_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PartnershipContact_partnershipId_idx" ON "PartnershipContact"("partnershipId");

ALTER TABLE "PartnershipContact" ADD CONSTRAINT "PartnershipContact_partnershipId_fkey"
    FOREIGN KEY ("partnershipId") REFERENCES "Partnership"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "PartnershipProject" (
    "id" TEXT NOT NULL,
    "partnershipId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "role" "PartnershipProjectRole" NOT NULL DEFAULT 'OTHER',
    "notes" TEXT,
    "referralValue" DOUBLE PRECISION,
    "currency" TEXT DEFAULT 'USD',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PartnershipProject_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PartnershipProject_partnershipId_projectId_key" ON "PartnershipProject"("partnershipId", "projectId");
CREATE INDEX "PartnershipProject_projectId_idx" ON "PartnershipProject"("projectId");
CREATE INDEX "PartnershipProject_role_idx" ON "PartnershipProject"("role");

ALTER TABLE "PartnershipProject" ADD CONSTRAINT "PartnershipProject_partnershipId_fkey"
    FOREIGN KEY ("partnershipId") REFERENCES "Partnership"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PartnershipProject" ADD CONSTRAINT "PartnershipProject_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─── Polymorphic FKs on File / ExternalLink / Comment ──────

ALTER TABLE "File" ADD COLUMN "subcontractorId" TEXT;
ALTER TABLE "File" ADD COLUMN "partnershipId" TEXT;
ALTER TABLE "File" ADD CONSTRAINT "File_subcontractorId_fkey"
    FOREIGN KEY ("subcontractorId") REFERENCES "Subcontractor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "File" ADD CONSTRAINT "File_partnershipId_fkey"
    FOREIGN KEY ("partnershipId") REFERENCES "Partnership"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ExternalLink" ADD COLUMN "subcontractorId" TEXT;
ALTER TABLE "ExternalLink" ADD COLUMN "partnershipId" TEXT;
ALTER TABLE "ExternalLink" ADD CONSTRAINT "ExternalLink_subcontractorId_fkey"
    FOREIGN KEY ("subcontractorId") REFERENCES "Subcontractor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ExternalLink" ADD CONSTRAINT "ExternalLink_partnershipId_fkey"
    FOREIGN KEY ("partnershipId") REFERENCES "Partnership"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Comment" ADD COLUMN "subcontractorId" TEXT;
ALTER TABLE "Comment" ADD COLUMN "partnershipId" TEXT;
ALTER TABLE "Comment" ADD CONSTRAINT "Comment_subcontractorId_fkey"
    FOREIGN KEY ("subcontractorId") REFERENCES "Subcontractor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Comment" ADD CONSTRAINT "Comment_partnershipId_fkey"
    FOREIGN KEY ("partnershipId") REFERENCES "Partnership"("id") ON DELETE CASCADE ON UPDATE CASCADE;
