-- One-time full-pull marker so syncs can backfill fields added after
-- rows were first pulled (Task.sourceLink / sourceReadOnly). Null on
-- existing integrations => their next sync walks every task once.
ALTER TABLE "GoogleTasksIntegration" ADD COLUMN "fullPulledAt" TIMESTAMP(3);
