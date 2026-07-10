-- Bids round-out: comments + file attachments on bid opportunities.

-- AlterTable
ALTER TABLE "Comment" ADD COLUMN "bidId" TEXT;
ALTER TABLE "File" ADD COLUMN "bidOpportunityId" TEXT;

-- CreateIndex
CREATE INDEX "File_bidOpportunityId_idx" ON "File"("bidOpportunityId");

-- AddForeignKey
ALTER TABLE "Comment" ADD CONSTRAINT "Comment_bidId_fkey" FOREIGN KEY ("bidId") REFERENCES "BidOpportunity"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "File" ADD CONSTRAINT "File_bidOpportunityId_fkey" FOREIGN KEY ("bidOpportunityId") REFERENCES "BidOpportunity"("id") ON DELETE CASCADE ON UPDATE CASCADE;
