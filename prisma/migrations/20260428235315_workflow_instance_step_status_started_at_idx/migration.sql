-- Index supports the watchdog sweep added in src/lib/workflows/engine.ts
-- (revertStuckSyncSteps): a synchronous-step revival query that filters
-- by status = 'IN_PROGRESS' and startedAt < cutoff. Without this index
-- the sweep would do a full scan on WorkflowInstanceStep.
CREATE INDEX "WorkflowInstanceStep_status_startedAt_idx"
  ON "WorkflowInstanceStep"("status", "startedAt");
