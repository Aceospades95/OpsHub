"use server";

import { db } from "@/lib/db";
import { requireAuth } from "@/lib/permissions";
import { runJob } from "@/lib/jobs";
import { revalidatePath } from "next/cache";

function requireAdmin(role: string) {
  if (role !== "ADMIN") throw new Error("Admin access required");
}

/**
 * Manually trigger a registered job from the admin UI. The runner records
 * the run in JobLog with triggeredBy=user.id so manual runs are
 * distinguishable from cron runs in the audit history.
 *
 * Force-runs (bypasses concurrency guard) so an admin can re-run a job
 * even if a previous instance is stuck.
 */
export async function triggerJob(jobKey: string) {
  const user = await requireAuth();
  requireAdmin(user.role);

  const result = await runJob(jobKey, user.id, { force: true });
  revalidatePath("/admin/jobs");
  return result;
}

/** Delete a single job log entry — admin maintenance. */
export async function deleteJobLog(id: string) {
  const user = await requireAuth();
  requireAdmin(user.role);

  await db.jobLog.delete({ where: { id } });
  revalidatePath("/admin/jobs");
  return { success: true };
}
