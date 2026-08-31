-- Task visibility: PUBLIC (current behavior) vs PRIVATE (creator +
-- assignee only). Backfill flips already-synced personal Google tasks
-- to PRIVATE — they are mirrors of someone's personal to-do list and
-- were browsable by every org-wide role and by any tasks-canView user
-- via search (project-less tasks passed every scope filter).

CREATE TYPE "TaskVisibility" AS ENUM ('PUBLIC', 'PRIVATE');

ALTER TABLE "Task" ADD COLUMN "visibility" "TaskVisibility" NOT NULL DEFAULT 'PUBLIC';

UPDATE "Task" SET "visibility" = 'PRIVATE' WHERE "sourceType" = 'google_tasks';
