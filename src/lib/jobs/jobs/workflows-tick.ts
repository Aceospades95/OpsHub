/**
 * workflows-tick
 *
 * Drives the workflow execution engine forward. Looks up every
 * IN_PROGRESS instance with a SCHEDULED step whose time has come and
 * processes it. Per the spec: should run every minute in production.
 *
 * Set up a cron entry pointing at:
 *   POST /api/jobs/run?job=workflows-tick
 * with the x-cron-secret header. Vercel-style example:
 *   { "path": "/api/jobs/run?job=workflows-tick", "schedule": "* * * * *" }
 *
 * Idempotent: the engine claims each step via an optimistic
 * SCHEDULED→IN_PROGRESS transition, so two workers racing against the
 * same row both come out clean — only one fires the handler.
 */

import { tick } from "@/lib/workflows/engine";
import type { JobDefinition } from "../types";

export const workflowsTick: JobDefinition = {
  key: "workflows-tick",
  name: "Workflows tick",
  description:
    "Process due steps for in-flight workflow instances. Run every minute in production.",
  schedule: "Every minute",

  async handler() {
    const result = await tick();
    const summary = `${result.fired} fired, ${result.completed} completed, ${result.failed} failed`;
    return {
      output: summary,
      processed: result.fired,
    };
  },
};
