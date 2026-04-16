-- Extend certifications: sign-off, jurisdiction, multi-tier reminders, POC,
-- agency contact, renewal checklist, renewal history.

-- CreateEnum: jurisdiction level (FEDERAL, STATE, COUNTY, CITY, AGENCY, PRIVATE, OTHER)
CREATE TYPE "JurisdictionLevel" AS ENUM (
  'FEDERAL', 'STATE', 'COUNTY', 'CITY', 'AGENCY', 'PRIVATE', 'OTHER'
);

-- CreateEnum: engagement type (SUBSCRIPTION vs CERTIFICATION)
CREATE TYPE "CertEngagementType" AS ENUM ('SUBSCRIPTION', 'CERTIFICATION');

-- AlterTable: Certification — add new fields
ALTER TABLE "Certification"
  ADD COLUMN "plainEnglishSummary" TEXT,
  ADD COLUMN "engagementType" "CertEngagementType" NOT NULL DEFAULT 'CERTIFICATION',
  ADD COLUMN "jurisdictionLevel" "JurisdictionLevel" NOT NULL DEFAULT 'OTHER',
  ADD COLUMN "jurisdictionName" TEXT,
  ADD COLUMN "agencyWebsiteUrl" TEXT,
  ADD COLUMN "agencyContactName" TEXT,
  ADD COLUMN "agencyContactEmail" TEXT,
  ADD COLUMN "agencyContactPhone" TEXT,
  ADD COLUMN "submittedDate" TIMESTAMP(3),
  ADD COLUMN "reminderOffsetsDays" INTEGER[] NOT NULL DEFAULT ARRAY[90, 30, 7]::INTEGER[],
  ADD COLUMN "firedReminderOffsets" INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[],
  ADD COLUMN "completedCertUrl" TEXT,
  ADD COLUMN "pointOfContactId" TEXT,
  ADD COLUMN "signedOffAt" TIMESTAMP(3),
  ADD COLUMN "signedOffById" TEXT,
  ADD COLUMN "signOffNotes" TEXT;

-- AddForeignKey: pointOfContact and signedOffBy
ALTER TABLE "Certification"
  ADD CONSTRAINT "Certification_pointOfContactId_fkey"
    FOREIGN KEY ("pointOfContactId") REFERENCES "User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Certification"
  ADD CONSTRAINT "Certification_signedOffById_fkey"
    FOREIGN KEY ("signedOffById") REFERENCES "User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable: CertificationRenewalChecklistItem
CREATE TABLE "CertificationRenewalChecklistItem" (
    "id" TEXT NOT NULL,
    "certificationId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "completed" BOOLEAN NOT NULL DEFAULT false,
    "completedAt" TIMESTAMP(3),
    "completedById" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CertificationRenewalChecklistItem_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CertificationRenewalChecklistItem_certificationId_sortOrder_idx"
  ON "CertificationRenewalChecklistItem"("certificationId", "sortOrder");

ALTER TABLE "CertificationRenewalChecklistItem"
  ADD CONSTRAINT "CertificationRenewalChecklistItem_certificationId_fkey"
    FOREIGN KEY ("certificationId") REFERENCES "Certification"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CertificationRenewalChecklistItem"
  ADD CONSTRAINT "CertificationRenewalChecklistItem_completedById_fkey"
    FOREIGN KEY ("completedById") REFERENCES "User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable: CertificationRenewalHistory
CREATE TABLE "CertificationRenewalHistory" (
    "id" TEXT NOT NULL,
    "certificationId" TEXT NOT NULL,
    "cycleStart" TIMESTAMP(3),
    "cycleEnd" TIMESTAMP(3),
    "issuedDate" TIMESTAMP(3),
    "expiredDate" TIMESTAMP(3),
    "signedOffById" TEXT,
    "signedOffAt" TIMESTAMP(3),
    "cost" DOUBLE PRECISION,
    "currency" TEXT DEFAULT 'USD',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CertificationRenewalHistory_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CertificationRenewalHistory_certificationId_createdAt_idx"
  ON "CertificationRenewalHistory"("certificationId", "createdAt");

ALTER TABLE "CertificationRenewalHistory"
  ADD CONSTRAINT "CertificationRenewalHistory_certificationId_fkey"
    FOREIGN KEY ("certificationId") REFERENCES "Certification"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CertificationRenewalHistory"
  ADD CONSTRAINT "CertificationRenewalHistory_signedOffById_fkey"
    FOREIGN KEY ("signedOffById") REFERENCES "User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
