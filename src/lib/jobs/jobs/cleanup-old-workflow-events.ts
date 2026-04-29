/**
 * cleanup-old-workflow-events
 *
 * Deletes WorkflowEvent rows older than the retention window.
 * WorkflowEvent records every state transition the engine makes
 * (instance_started, step_completed, step_failed, etc.) so the
 * /admin/workflows timeline can show what happened. Default 365-day
 * retention — instance lifecycles are typically days to weeks, so
 * a year of history covers any plausible "what happened?" question.
 *
 * Override with WORKFLOW_EVENT_RETENTION_DAYS in env.
 *
 * Skips events tied to instances that haven't reached a terminal
 * state yet — an in-flight instance still needs its full timeline
 * regardless of age.
 */

import { db } from "@/lib/db";
import { shouldRunWeekly } from "../gating";
import type { JobDefinition } from "../types";

const DEFAULT_RETENTION_DAYS = 365;

export const cleanupOldWorkflowEvents: JobDefinition = {
  key: "cleanup-old-workflow-events",
  name: "Cleanup old workflow events",
  description:
    "Deletes WorkflowEvent rows older than the retention window for terminal instances (default 365 days; override with WORKFLOW_EVENT_RETENTION_DAYS).",
  schedule: "Weekly",

  async handler() {
    if (!(await shouldRunWeekly("cleanup-old-workflow-events"))) {
      return { status: "skipped", output: "Already ran this week", processed: 0 };
    }
    const raw = process.env.WORKFLOW_EVENT_RETENTION_DAYS;
    const parsed = raw ? Number.parseInt(raw, 10) : DEFAULT_RETENTION_DAYS;
    const days =
      Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_RETENTION_DAYS;

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);

    // Only purge events for instances that have themselves reached a
    // terminal state. An in-flight instance (PENDING/IN_PROGRESS/PAUSED)
    // keeps its timeline regardless of event age — admins need the
    // full history to debug a stalled flow.
    const result = await db.workflowEvent.deleteMany({
      where: {
        createdAt: { lt: cutoff },
        workflowInstance: {
          status: { in: ["COMPLETED", "CANCELLED"] },
        },
      },
    });

    return {
      output: `Deleted ${result.count} workflow event row${result.count === 1 ? "" : "s"} older than ${days} days`,
      processed: result.count,
    };
  },
};
