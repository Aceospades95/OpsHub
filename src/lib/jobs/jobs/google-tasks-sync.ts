import { db } from "@/lib/db";
import { syncGoogleTasksForUser } from "@/lib/google-tasks/sync";
import { googleTasksConfigured } from "@/lib/google-tasks/api";
import type { JobDefinition } from "../types";

/**
 * Two-way Google Tasks sync for every connected user. Google Tasks has
 * no webhooks, so this polls. Cheap when nothing changed (one list call
 * per integration), so it can ride the same high-frequency cron entry as
 * workflows-tick — add `?job=google-tasks-sync` on a 5-minute schedule,
 * or let the hourly all-jobs pass pick it up. The /my "Sync now" button
 * hits the same engine for on-demand freshness.
 */
export const googleTasksSync: JobDefinition = {
  key: "google-tasks-sync",
  name: "Google Tasks sync",
  description:
    "Pulls quick-added Google Tasks into the /my inbox and pushes completions/edits of synced tasks back to Google.",
  schedule: "Every 5 minutes (recommended cron: ?job=google-tasks-sync)",
  async handler() {
    if (!googleTasksConfigured()) {
      return { output: "Skipped — GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET not set", status: "skipped" };
    }

    const integrations = await db.googleTasksIntegration.findMany({
      select: { userId: true },
    });
    if (integrations.length === 0) {
      return { output: "No connected users", processed: 0 };
    }

    let pulled = 0;
    let pushed = 0;
    const failures: string[] = [];
    for (const { userId } of integrations) {
      const result = await syncGoogleTasksForUser(userId);
      pulled += result.pulledCreated + result.pulledUpdated;
      pushed += result.pushed;
      if (result.errors.length > 0) {
        failures.push(`${userId}: ${result.errors[0]}`);
      }
    }

    const summary = `${integrations.length} user(s) — pulled ${pulled}, pushed ${pushed}` +
      (failures.length > 0 ? `; ${failures.length} failed (${failures[0]})` : "");
    return { output: summary, processed: pulled + pushed };
  },
};
