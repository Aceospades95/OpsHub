-- Opt-in work-log roster. Default false: nobody is expected to submit
-- (or gets reminded) until deliberately enrolled — the launch default
-- of "every active user owes logs" mass-emailed the whole company.
ALTER TABLE "User" ADD COLUMN "workLogRequired" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN "workLogRequiredSince" TIMESTAMP(3);
