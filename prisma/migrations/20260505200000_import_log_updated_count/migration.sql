-- Adds the `updated` count column to ImportLog so the audit log can
-- distinguish create-only imports (everything in `imported`) from
-- upsert imports (some new in `imported`, some matched-and-updated
-- in `updated`). Defaults to 0 so historical rows keep their
-- original meaning without a backfill.

ALTER TABLE "ImportLog" ADD COLUMN "updated" INTEGER NOT NULL DEFAULT 0;
