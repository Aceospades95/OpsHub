/**
 * activity-audit-full — every event from the last 30 days, one row per
 * ActivityLog entry. Pairs with the bucketed `activity-audit` report:
 *
 *   - `activity-audit` is a summary view (counts per user / action) that
 *     reads well in an email digest or a quick admin glance.
 *   - this `-full` variant is the underlying detail. It returns one row
 *     per event so admins can download a CSV for compliance archives or
 *     dig into specifics that the summary buckets away.
 *
 * Schedulable is deliberately false here — the row count grows linearly
 * with org activity and the email body would be huge. Admins should pull
 * this on demand via the "Download CSV" action on the report detail
 * page.
 */

import { db } from "@/lib/db";
import type { ReportDefinition } from "../types";
import { format } from "date-fns";

// 30-day window — wider than the summary's 7-day default because the
// detail report is the audit-trail view and 30 days is the more common
// retention horizon for compliance asks. The summary report stays
// 7 days so the email digest is short enough to read at a glance.
const WINDOW_DAYS = 30;

export const activityAuditFull: ReportDefinition = {
  key: "activity-audit-full",
  name: "Activity audit (full detail, 30 days)",
  description:
    "Every logged event in the last 30 days — one row per action. Pair with the summary view for quick counts; download the CSV for compliance archives.",
  module: "admin",
  schedulable: false,

  async run() {
    const since = new Date();
    since.setDate(since.getDate() - WINDOW_DAYS);

    const logs = await db.activityLog.findMany({
      where: { createdAt: { gte: since } },
      orderBy: { createdAt: "desc" },
      include: {
        user: { select: { name: true, email: true } },
        project: { select: { name: true } },
        client: { select: { name: true } },
      },
      take: 5000,
    });

    const rows = logs.map((log) => ({
      timestamp: log.createdAt,
      user: log.user?.name || log.userId,
      userEmail: log.user?.email || "—",
      action: log.action,
      entityType: log.entityType,
      entityId: log.entityId,
      project: log.project?.name || "—",
      client: log.client?.name || "—",
      details: log.details || "—",
    }));

    // Group counts so the summary headline still tells you what's in
    // the export at a glance — separate from the detail rows.
    const distinctUsers = new Set(logs.map((l) => l.userId)).size;
    const distinctActions = new Set(logs.map((l) => l.action)).size;
    const truncated = logs.length === 5000;

    return {
      summary: `${logs.length}${truncated ? "+" : ""} events in the last ${WINDOW_DAYS} days · ${distinctUsers} user${distinctUsers === 1 ? "" : "s"} · ${distinctActions} action type${distinctActions === 1 ? "" : "s"}${truncated ? " · capped at 5,000 rows" : ""}.`,
      columns: [
        {
          key: "timestamp",
          label: "When",
          format: (v) =>
            v instanceof Date ? format(v, "yyyy-MM-dd HH:mm:ss") : String(v ?? ""),
        },
        { key: "user", label: "User" },
        { key: "userEmail", label: "Email" },
        { key: "action", label: "Action" },
        { key: "entityType", label: "Entity" },
        { key: "entityId", label: "Entity ID" },
        { key: "project", label: "Project" },
        { key: "client", label: "Client" },
        { key: "details", label: "Details" },
      ],
      rows,
      emptyMessage: `No activity logged in the last ${WINDOW_DAYS} days.`,
    };
  },
};
