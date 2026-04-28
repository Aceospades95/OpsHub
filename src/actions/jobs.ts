"use server";

import { db } from "@/lib/db";
import { requireAuth } from "@/lib/permissions";
import { runJob, getJob } from "@/lib/jobs";
import { logActivity } from "@/lib/activity";
import { revalidatePath } from "next/cache";

function requireAdmin(role: string): { error: string } | null {
  if (role !== "ADMIN") return { error: "Admin access required" };
  return null;
}

/**
 * Manually trigger a registered job from the admin UI. The runner records
 * the run in JobLog with triggeredBy=user.id so manual runs are
 * distinguishable from cron runs in the audit history.
 *
 * Force-runs (bypasses concurrency guard) so an admin can re-run a job
 * even if a previous instance is stuck. Force also overrides the
 * disabled-toggle, so manual testing of a paused job stays possible.
 */
export async function triggerJob(jobKey: string) {
  const user = await requireAuth();
  const gate = requireAdmin(user.role);
  if (gate) return gate;

  const result = await runJob(jobKey, user.id, { force: true });
  revalidatePath("/admin/jobs");
  revalidatePath(`/admin/jobs/${jobKey}`);
  return result;
}

/** Delete a single job log entry — admin maintenance. */
export async function deleteJobLog(id: string) {
  const user = await requireAuth();
  const gate = requireAdmin(user.role);
  if (gate) return gate;

  await db.jobLog.delete({ where: { id } });
  revalidatePath("/admin/jobs");
  return { success: true };
}

/**
 * Enable or disable a registered job. Disabled jobs are skipped by the
 * cron runner but can still be force-run manually from the admin UI.
 *
 * The JobConfig row is created lazily on first toggle — every job is
 * implicitly enabled until an admin opts to pause it.
 */
export async function toggleJobEnabled(jobKey: string, isEnabled: boolean) {
  const user = await requireAuth();
  const gate = requireAdmin(user.role);
  if (gate) return gate;

  if (!getJob(jobKey)) {
    return { error: `No job registered with key "${jobKey}"` } as const;
  }

  await db.jobConfig.upsert({
    where: { jobKey },
    update: { isEnabled },
    create: { jobKey, isEnabled },
  });
  await logActivity(
    isEnabled ? "enabled" : "disabled",
    "job",
    jobKey,
    user.id,
    jobKey
  );
  revalidatePath("/admin/jobs");
  revalidatePath(`/admin/jobs/${jobKey}`);
  return { success: true } as const;
}
