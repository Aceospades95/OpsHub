-- CRM phase 2, all additive:
--   1. ContactInteraction — dated touch-log per contact
--   2. QuoteTemplate variants (self-FK + label)
--   3. Google Tasks subtask hierarchy + manual order columns

-- 1. ContactInteraction
CREATE TABLE "ContactInteraction" (
    "id" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "summary" TEXT NOT NULL,
    "notes" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContactInteraction_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ContactInteraction_contactId_occurredAt_idx" ON "ContactInteraction"("contactId", "occurredAt");

ALTER TABLE "ContactInteraction" ADD CONSTRAINT "ContactInteraction_contactId_fkey"
    FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ContactInteraction" ADD CONSTRAINT "ContactInteraction_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 2. Quote template variants
ALTER TABLE "QuoteTemplate" ADD COLUMN "variantOfId" TEXT;
ALTER TABLE "QuoteTemplate" ADD COLUMN "variantLabel" TEXT;

CREATE INDEX "QuoteTemplate_variantOfId_idx" ON "QuoteTemplate"("variantOfId");

ALTER TABLE "QuoteTemplate" ADD CONSTRAINT "QuoteTemplate_variantOfId_fkey"
    FOREIGN KEY ("variantOfId") REFERENCES "QuoteTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 3. Google subtask hierarchy + manual order (pull-only fidelity)
ALTER TABLE "Task" ADD COLUMN "googleParentId" TEXT;
ALTER TABLE "Task" ADD COLUMN "googlePosition" TEXT;
