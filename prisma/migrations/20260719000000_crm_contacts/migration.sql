-- ─── CRM foundation ────────────────────────────────────────────────────
-- Unified Contact + polymorphic ContactLink (replaces the four siloed
-- per-org contact tables, which are kept read-only for rollback);
-- evidence links on clients + bids; bid outcome fields; split notes
-- fields; org-wide module sidebar visibility.

CREATE TABLE "Contact" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "title" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "organization" TEXT,
    "notes" TEXT,
    "isFormer" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    CONSTRAINT "Contact_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Contact_email_idx" ON "Contact"("email");
CREATE INDEX "Contact_name_idx" ON "Contact"("name");

CREATE TABLE "ContactLink" (
    "id" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "roles" TEXT[] NOT NULL DEFAULT '{}',
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ContactLink_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ContactLink_contactId_entityType_entityId_key" ON "ContactLink"("contactId", "entityType", "entityId");
CREATE INDEX "ContactLink_entityType_entityId_idx" ON "ContactLink"("entityType", "entityId");
ALTER TABLE "ContactLink" ADD CONSTRAINT "ContactLink_contactId_fkey"
  FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Evidence links: clients + bids join the targets ExternalLink serves.
ALTER TABLE "ExternalLink" ADD COLUMN "clientId" TEXT;
ALTER TABLE "ExternalLink" ADD COLUMN "bidOpportunityId" TEXT;
ALTER TABLE "ExternalLink" ADD CONSTRAINT "ExternalLink_clientId_fkey"
  FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ExternalLink" ADD CONSTRAINT "ExternalLink_bidOpportunityId_fkey"
  FOREIGN KEY ("bidOpportunityId") REFERENCES "BidOpportunity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Bid outcomes: incumbent, split notes, and the won-bid → contract /
-- end-client joins that make prime/channel deals legible.
ALTER TABLE "BidOpportunity" ADD COLUMN "incumbent" TEXT;
ALTER TABLE "BidOpportunity" ADD COLUMN "sourceNotes" TEXT;
ALTER TABLE "BidOpportunity" ADD COLUMN "openQuestions" TEXT;
ALTER TABLE "BidOpportunity" ADD COLUMN "contractId" TEXT;
ALTER TABLE "BidOpportunity" ADD COLUMN "endClientId" TEXT;
ALTER TABLE "BidOpportunity" ADD CONSTRAINT "BidOpportunity_contractId_fkey"
  FOREIGN KEY ("contractId") REFERENCES "Contract"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "BidOpportunity" ADD CONSTRAINT "BidOpportunity_endClientId_fkey"
  FOREIGN KEY ("endClientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Split notes fields (provenance + open questions) on the records
-- people have been cramming everything into.
ALTER TABLE "Client" ADD COLUMN "sourceNotes" TEXT;
ALTER TABLE "Client" ADD COLUMN "openQuestions" TEXT;
ALTER TABLE "Project" ADD COLUMN "sourceNotes" TEXT;
ALTER TABLE "Project" ADD COLUMN "openQuestions" TEXT;

-- Sidebar visibility per module (absence of a row = shown).
CREATE TABLE "ModuleSetting" (
    "module" TEXT NOT NULL,
    "hiddenInSidebar" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ModuleSetting_pkey" PRIMARY KEY ("module")
);

-- ─── Backfill: unify existing contacts ────────────────────────────────
-- One Contact per person, deduped by email when present (the same
-- address on a client and a partnership becomes ONE person with two
-- links). Rows without an email stay separate — merging by name alone
-- would conflate different people. Old tables remain untouched.
WITH staged AS (
  SELECT "name", "title", "email", "phone", "notes", "isPrimary", 'client' AS etype, "clientId" AS eid, "createdAt" FROM "ClientContact"
  UNION ALL
  SELECT "name", "title", "email", "phone", "notes", "isPrimary", 'supplier', "supplierId", "createdAt" FROM "SupplierContact"
  UNION ALL
  SELECT "name", "title", "email", "phone", "notes", "isPrimary", 'subcontractor', "subcontractorId", "createdAt" FROM "SubcontractorContact"
  UNION ALL
  SELECT "name", "title", "email", "phone", "notes", "isPrimary", 'partnership', "partnershipId", "createdAt" FROM "PartnershipContact"
  UNION ALL
  SELECT "primaryContactName", NULL, "primaryContactEmail", "primaryContactPhone", NULL, true, 'subcontractor', "id", "createdAt"
    FROM "Subcontractor" WHERE COALESCE(TRIM("primaryContactName"), '') <> '' AND "deletedAt" IS NULL
  UNION ALL
  SELECT "primaryContactName", NULL, "primaryContactEmail", "primaryContactPhone", NULL, true, 'partnership', "id", "createdAt"
    FROM "Partnership" WHERE COALESCE(TRIM("primaryContactName"), '') <> '' AND "deletedAt" IS NULL
),
keyed AS (
  SELECT *,
    CASE WHEN COALESCE(TRIM("email"), '') <> ''
         THEN 'e:' || LOWER(TRIM("email"))
         ELSE 'n:' || MD5(LOWER(TRIM("name")) || ':' || etype || ':' || eid)
    END AS k
  FROM staged
  WHERE COALESCE(TRIM("name"), '') <> ''
)
INSERT INTO "Contact" ("id", "name", "title", "email", "phone", "notes", "updatedAt")
SELECT DISTINCT ON (k)
  'ct_' || MD5(k),
  TRIM("name"),
  NULLIF(TRIM("title"), ''),
  NULLIF(TRIM("email"), ''),
  NULLIF(TRIM("phone"), ''),
  NULLIF(TRIM("notes"), ''),
  CURRENT_TIMESTAMP
FROM keyed
ORDER BY k, "createdAt" ASC;

WITH staged AS (
  SELECT "name", "email", "isPrimary", 'client' AS etype, "clientId" AS eid FROM "ClientContact"
  UNION ALL
  SELECT "name", "email", "isPrimary", 'supplier', "supplierId" FROM "SupplierContact"
  UNION ALL
  SELECT "name", "email", "isPrimary", 'subcontractor', "subcontractorId" FROM "SubcontractorContact"
  UNION ALL
  SELECT "name", "email", "isPrimary", 'partnership', "partnershipId" FROM "PartnershipContact"
  UNION ALL
  SELECT "primaryContactName", "primaryContactEmail", true, 'subcontractor', "id"
    FROM "Subcontractor" WHERE COALESCE(TRIM("primaryContactName"), '') <> '' AND "deletedAt" IS NULL
  UNION ALL
  SELECT "primaryContactName", "primaryContactEmail", true, 'partnership', "id"
    FROM "Partnership" WHERE COALESCE(TRIM("primaryContactName"), '') <> '' AND "deletedAt" IS NULL
),
keyed AS (
  SELECT *,
    CASE WHEN COALESCE(TRIM("email"), '') <> ''
         THEN 'e:' || LOWER(TRIM("email"))
         ELSE 'n:' || MD5(LOWER(TRIM("name")) || ':' || etype || ':' || eid)
    END AS k
  FROM staged
  WHERE COALESCE(TRIM("name"), '') <> ''
)
INSERT INTO "ContactLink" ("id", "contactId", "entityType", "entityId", "isPrimary")
SELECT DISTINCT ON (k, etype, eid)
  'cl_' || MD5(k || ':' || etype || ':' || eid),
  'ct_' || MD5(k),
  etype,
  eid,
  "isPrimary"
FROM keyed
ORDER BY k, etype, eid, "isPrimary" DESC;
