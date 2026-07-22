-- Task: which Google list a synced task lives in (denormalized from
-- the composite sourceId for display/grouping).
ALTER TABLE "Task" ADD COLUMN "googleListId" TEXT;

-- Per-user mirror of Google Tasks lists (names + default flag),
-- refreshed every sync; powers grouping, badges, and the send-to-
-- Google destination picker.
CREATE TABLE "GoogleTaskList" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "listId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "lastSeenAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "GoogleTaskList_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "GoogleTaskList_userId_listId_key" ON "GoogleTaskList"("userId", "listId");

ALTER TABLE "GoogleTaskList" ADD CONSTRAINT "GoogleTaskList_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
