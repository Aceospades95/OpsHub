import { db } from "@/lib/db";

export async function logActivity(
  action: string,
  entityType: string,
  entityId: string,
  userId: string,
  details?: string
) {
  await db.activityLog.create({
    data: { action, entityType, entityId, userId, details },
  });
}
