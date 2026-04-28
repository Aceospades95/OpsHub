/**
 * workflow-scheduled-triggers
 *
 * Daily evaluator for SCHEDULED_DATE workflow triggers — the kind that
 * say "fire 7 days before User.terminationDate". Distinct from the
 * minute-by-minute workflows-tick (which advances steps inside running
 * instances) because we only need to check date fields once per day,
 * and stuffing date logic into the per-minute loop would slow it for
 * no benefit.
 *
 * Schedule daily, ideally early-morning UTC, with:
 *   POST /api/jobs/run?job=workflow-scheduled-triggers
 *
 * Idempotency lives in fireScheduledDateTriggers itself — it skips
 * subjects that already have a non-cancelled instance of the template,
 * so re-running the job within the same day is safe.
 */

import { fireScheduledDateTriggers } from "@/lib/workflows/triggers";
import { shouldRunDaily } from "../gating";
import type { JobDefinition } from "../types";

export const workflowScheduledTriggers: JobDefinition = {
  key: "workflow-scheduled-triggers",
  name: "Workflow scheduled-date triggers",
  description:
    "Evaluates SCHEDULED_DATE workflow triggers (e.g. fire offboarding 7 days before termination).",
  schedule: "Daily",

  async handler() {
    if (!(await shouldRunDaily("workflow-scheduled-triggers"))) {
      return { status: "skipped", output: "Already ran today", processed: 0 };
    }
    const result = await fireScheduledDateTriggers();
    const summary =
      `${result.instanceIds.length} instance(s) spawned` +
      (result.errors.length ? ` · ${result.errors.length} error(s)` : "");
    return {
      output: summary,
      processed: result.instanceIds.length,
      ...(result.errors.length > 0
        ? { error: result.errors.join("\n") }
        : {}),
    };
  },
};
