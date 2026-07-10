"use server";

import { db } from "@/lib/db";
import { requireAuth } from "@/lib/permissions";
import { syncGoogleTasksForUser } from "@/lib/google-tasks/sync";
import { revalidatePath } from "next/cache";

/**
 * Run the Google Tasks sync for the signed-in user and return the
 * counts as JSON. Backs both the manual "Sync" button and the
 * auto-sync interval on /my (neither needs the full-page redirect the
 * legacy route does).
 */
export async function syncGoogleTasksAction() {
  const user = await requireAuth();
  const result = await syncGoogleTasksForUser(user.id);
  revalidatePath("/my");
  return {
    pulledCreated: result.pulledCreated,
    pulledUpdated: result.pulledUpdated,
    pushed: result.pushed,
    error: result.errors.length > 0 ? result.errors[0] : undefined,
  };
}

/** Allowed auto-sync cadences (minutes). 0 = off. */
const AUTO_SYNC_CHOICES = new Set([0, 5, 15, 30, 60]);

/**
 * Set how often /my auto-syncs Google Tasks while open. Stored on the
 * user's integration; 0 turns it off. (This is client-side polling
 * while the page is open — true background cadence is the cron entry
 * hitting the google-tasks-sync job, see docs/deployment.md.)
 */
export async function setGoogleAutoSync(minutes: number) {
  const user = await requireAuth();
  if (!AUTO_SYNC_CHOICES.has(minutes)) return { error: "Invalid interval" };

  const integration = await db.googleTasksIntegration.findUnique({
    where: { userId: user.id },
    select: { id: true },
  });
  if (!integration) return { error: "Google Tasks is not connected" };

  await db.googleTasksIntegration.update({
    where: { id: integration.id },
    data: { autoSyncMinutes: minutes === 0 ? null : minutes },
  });
  revalidatePath("/my");
  return { success: true };
}
