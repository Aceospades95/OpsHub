-- Add userId + category fields to File so employee profiles can attach
-- files (resumes, ID photos, certification scans, training records).
--
-- userId is nullable like every other FK on this table — a single File
-- row still references exactly one parent entity at a time. category is
-- a free-form tag used by the employee files UI to group uploads.

ALTER TABLE "File" ADD COLUMN "userId" TEXT;
ALTER TABLE "File" ADD COLUMN "category" TEXT;

ALTER TABLE "File"
  ADD CONSTRAINT "File_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "File_userId_idx" ON "File"("userId");
