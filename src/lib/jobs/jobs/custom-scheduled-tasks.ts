/**
 * custom-scheduled-tasks
 *
 * Hourly tick that drives admin-built ScheduledTask rows forward.
 * Distinct from src/lib/jobs/ which holds code-defined system jobs.
 *
 * Schedule hourly via cron, e.g.:
 *   POST /api/jobs/run?job=custom-scheduled-tasks
 *   { "schedule": "0 * * * *" }
 *
 * Idempotency: each task tracks its lastRunAt so re-running this job
 * within the same scheduling window is a no-op. The runner short-
 * circuits skipped tasks so the cost is one query per active task.
 */

import { tickAll } from "@/lib/scheduled-tasks/runner";
import type { JobDefinition } from "../types";

export const customScheduledTasks: JobDefinition = {
  key: "custom-scheduled-tasks",
  name: "Custom scheduled tasks",
  description:
    "Fires admin-built tasks (email-a-report, send-a-message) whose configured cadence is due.",
  schedule: "Hourly",

  async handler() {
    const r = await tickAll();
    const summary = `${r.fired} fired, ${r.failed} failed, ${r.skipped} skipped (of ${r.considered} active)`;
    return { output: summary, processed: r.fired };
  },
};
