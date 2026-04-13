/**
 * cleanup-stale-notifications
 *
 * Pure maintenance job. Deletes read notifications older than 60 days so
 * the Notification table doesn't grow forever. Unread notifications are
 * always kept regardless of age — if you've never seen it, we shouldn't
 * silently throw it away.
 *
 * Run weekly via cron. Idempotent — running multiple times in a row is
 * safe (the second run just finds zero rows).
 */

import { db } from "@/lib/db";
import type { JobDefinition } from "../types";

export const cleanupStaleNotifications: JobDefinition = {
  key: "cleanup-stale-notifications",
  name: "Cleanup stale notifications",
  description:
    "Deletes read notifications older than 60 days. Unread notifications are kept regardless of age.",
  schedule: "Weekly",

  async handler() {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 60);

    const result = await db.notification.deleteMany({
      where: {
        readAt: { not: null, lt: cutoff },
      },
    });

    return {
      output: `Deleted ${result.count} read notification${result.count === 1 ? "" : "s"} older than 60 days`,
      processed: result.count,
    };
  },
};
