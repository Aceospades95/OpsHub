import { db } from "@/lib/db";

export async function logActivity(
  action: string,
  entityType: string,
  entityId: string,
  userId: string,
  details?: string,
  options?: { projectId?: string | null; clientId?: string | null }
) {
  await db.activityLog.create({
    data: {
      action,
      entityType,
      entityId,
      userId,
      details,
      projectId: options?.projectId ?? null,
      clientId: options?.clientId ?? null,
    },
  });
}
