/**
 * activity-audit — who did what in the last 7 days.
 *
 * Pulls the ActivityLog table, grouped by user + action type. Useful for
 * compliance/governance or just a weekly "what happened this week" digest.
 */

import { db } from "@/lib/db";
import type { ReportDefinition } from "../types";

export const activityAudit: ReportDefinition = {
  key: "activity-audit",
  name: "Activity audit (7 days)",
  description:
    "Counts of actions logged against entities in the last 7 days, grouped by user and action type.",
  module: "admin",
  schedulable: true,

  async run() {
    const since = new Date();
    since.setDate(since.getDate() - 7);

    const logs = await db.activityLog.findMany({
      where: { createdAt: { gte: since } },
      select: {
        action: true,
        entityType: true,
        userId: true,
      },
    });

    // Bucket by userId + action
    type Bucket = {
      userId: string;
      action: string;
      count: number;
      entityTypes: Set<string>;
    };
    const buckets = new Map<string, Bucket>();
    for (const log of logs) {
      const key = `${log.userId}|${log.action}`;
      const existing = buckets.get(key);
      if (existing) {
        existing.count++;
        existing.entityTypes.add(log.entityType);
      } else {
        buckets.set(key, {
          userId: log.userId,
          action: log.action,
          count: 1,
          entityTypes: new Set([log.entityType]),
        });
      }
    }

    // Look up user names in one query
    const bucketValues = Array.from(buckets.values());
    const userIds = Array.from(new Set(bucketValues.map((b) => b.userId)));
    const users = await db.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, name: true },
    });
    const userById = new Map(users.map((u) => [u.id, u.name]));

    const rows = bucketValues
      .map((b) => ({
        user: userById.get(b.userId) || b.userId,
        action: b.action,
        count: b.count,
        entityTypes: Array.from(b.entityTypes).sort().join(", "),
      }))
      .sort((a, b) => b.count - a.count);

    return {
      summary: `${logs.length} logged event${logs.length === 1 ? "" : "s"} in the last 7 days across ${userIds.length} user${userIds.length === 1 ? "" : "s"}.`,
      columns: [
        { key: "user", label: "User" },
        { key: "action", label: "Action" },
        { key: "count", label: "Count", align: "right" },
        { key: "entityTypes", label: "Entities touched" },
      ],
      rows,
      emptyMessage: "No activity logged in the last 7 days.",
    };
  },
};
