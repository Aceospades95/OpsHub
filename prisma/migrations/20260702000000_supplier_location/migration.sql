-- Short city/region label for the grouped supplier list — distinct from
-- the free-form mailing `address`.

-- AlterTable
ALTER TABLE "Supplier" ADD COLUMN     "location" TEXT;
