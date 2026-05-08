-- Add nullable `slug` columns to Client / Project / IntranetResource
-- with a unique index. The slug is filled at create time by the
-- application layer (src/lib/slug.ts) for new rows; existing rows
-- stay NULL until the operator runs prisma/backfill-slugs.ts. Detail
-- pages resolve by slug-or-id (slug-first, fallback to cuid) so old
-- bookmarks keep working.

ALTER TABLE "Client"
  ADD COLUMN "slug" TEXT;

ALTER TABLE "Project"
  ADD COLUMN "slug" TEXT;

ALTER TABLE "IntranetResource"
  ADD COLUMN "slug" TEXT;

CREATE UNIQUE INDEX "Client_slug_key" ON "Client"("slug");
CREATE UNIQUE INDEX "Project_slug_key" ON "Project"("slug");
CREATE UNIQUE INDEX "IntranetResource_slug_key" ON "IntranetResource"("slug");
