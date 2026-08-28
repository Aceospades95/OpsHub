-- Task: remember which dueDate the task-due-reminders job notified
-- about, so each due date fires at most once (re-arms on change).
ALTER TABLE "Task" ADD COLUMN "dueNotifiedFor" TIMESTAMP(3);

-- User: opt-in daily email digest for notification emails.
ALTER TABLE "User" ADD COLUMN "notificationEmailDigest" BOOLEAN NOT NULL DEFAULT false;

-- Notification: stamp rows that were delivered in a digest email.
ALTER TABLE "Notification" ADD COLUMN "digestedAt" TIMESTAMP(3);
CREATE INDEX "Notification_digestedAt_idx" ON "Notification"("digestedAt");
