-- Adds a per-job cadence override so admins can tune scheduled-job
-- frequency from /admin/jobs without a code deploy.
--
-- NULL means "use the code-defined cadence" (no behavior change for
-- existing rows). The runtime in src/lib/jobs/gating.ts validates the
-- value against the CADENCE_OVERRIDES allowlist before honoring it,
-- so a hand-edited bogus value falls back to the code default.
ALTER TABLE "JobConfig" ADD COLUMN "cadence" TEXT;
