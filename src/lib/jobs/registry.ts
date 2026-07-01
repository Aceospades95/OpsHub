/**
 * Job registry — the canonical list of every scheduled job.
 *
 * Adding a new job:
 *   1. Create a new file in src/lib/jobs/jobs/ exporting a JobDefinition
 *   2. Import it here and add it to JOBS
 *   3. The admin /admin/jobs page picks it up automatically
 *   4. The cron endpoint POST /api/jobs/run can run it by key, or run
 *      all jobs if no key is specified
 *
 * Jobs should be:
 *   - Idempotent (safe to re-run)
 *   - Self-contained (don't depend on shared mutable state)
 *   - Bounded (finish in seconds, not minutes — use a queue for heavy work)
 */

import type { JobDefinition } from "./types";
import { contractExpiryCheck } from "./jobs/contract-expiry-check";
import { certificationExpiryCheck } from "./jobs/certification-expiry-check";
import { cleanupStaleNotifications } from "./jobs/cleanup-stale-notifications";
import { cleanupOldActivityLogs } from "./jobs/cleanup-old-activity-logs";
import { cleanupOldJobLogs } from "./jobs/cleanup-old-job-logs";
import { cleanupOldEmailLogs } from "./jobs/cleanup-old-email-logs";
import { cleanupOldWorkflowEvents } from "./jobs/cleanup-old-workflow-events";
import { dailyReportsDigest } from "./jobs/daily-reports-digest";
import { workflowsTick } from "./jobs/workflows-tick";
import { workflowScheduledTriggers } from "./jobs/workflow-scheduled-triggers";
import { workflowReminderDigest } from "./jobs/workflow-reminder-digest";
import { customScheduledTasks } from "./jobs/custom-scheduled-tasks";
import { googleTasksSync } from "./jobs/google-tasks-sync";

export const JOBS: JobDefinition[] = [
  contractExpiryCheck,
  certificationExpiryCheck,
  cleanupStaleNotifications,
  cleanupOldActivityLogs,
  cleanupOldJobLogs,
  cleanupOldEmailLogs,
  cleanupOldWorkflowEvents,
  dailyReportsDigest,
  workflowsTick,
  workflowScheduledTriggers,
  workflowReminderDigest,
  customScheduledTasks,
  googleTasksSync,
];

const JOB_MAP = new Map<string, JobDefinition>(JOBS.map((j) => [j.key, j]));

/** Look up a job by key. Returns undefined if unknown. */
export function getJob(key: string): JobDefinition | undefined {
  return JOB_MAP.get(key);
}

/** Return every registered job. Used by the admin UI and runAllJobs(). */
export function listJobs(): JobDefinition[] {
  return JOBS;
}
