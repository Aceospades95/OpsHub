-- Review fixes (July 2026 feedback-batch code review)
--
-- 1. DisciplinaryReport.employeeId: CASCADE -> RESTRICT. Hard-deleting a
--    user must never silently destroy the HR paper trail; deleteUser
--    catches the FK violation (P2003) and tells the admin to deactivate
--    or merge instead. merge-users reassigns these rows explicitly.
ALTER TABLE "DisciplinaryReport" DROP CONSTRAINT "DisciplinaryReport_employeeId_fkey";
ALTER TABLE "DisciplinaryReport" ADD CONSTRAINT "DisciplinaryReport_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 2. Supplier receipts query support: the supplier detail page filters
--    File by (supplierId, category) — the only column-filtered File read
--    without a covering index.
CREATE INDEX "File_supplierId_category_idx" ON "File"("supplierId", "category");
