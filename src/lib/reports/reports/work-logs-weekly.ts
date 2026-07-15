/**
 * work-logs-weekly — rolling 4-week per-person work-log roll-up (the
 * spreadsheet's trend tab). One row per person per ISO week: days
 * submitted vs expected (expected honors schedule exceptions and
 * roster windows), total hours, overtime hours past the 40h line, and
 * whether that overtime was approved (WorkWeekFlag).
 *
 * The current (partial) week is included with "expected" counted only
 * up to today, so mid-week the denominator stays honest.
 */

import { db } from "@/lib/db";
import type { ReportDefinition } from "../types";
import {
  OVERTIME_WEEK_HOURS,
  expectedWorkdays,
  isExceptedDay,
  isoWeekKey,
  rosterWindow,
  shiftWeekKey,
  startOfUtcDay,
  weekBounds,
  weekTotals,
} from "@/lib/worklogs";

const WEEKS = 4;

export const workLogsWeekly: ReportDefinition = {
  key: "work-logs-weekly",
  name: "Work logs — weekly summary",
  description:
    "Last 4 ISO weeks × person: days submitted vs expected (exceptions honored), total hours, overtime past 40h, and overtime-approval state. The rolling trend view the reminder sheet used to keep.",
  module: "work-logs",
  schedulable: true,

  async run() {
    const today = startOfUtcDay(new Date());
    const currentKey = isoWeekKey(today);
    // Newest first — the requested sort order.
    const weekKeys = Array.from({ length: WEEKS }, (_, i) => shiftWeekKey(currentKey, -i));
    const rangeStart = weekBounds(weekKeys[WEEKS - 1]).start;
    const rangeEnd = weekBounds(weekKeys[0]).end;

    const [users, logs, exceptions, flags] = await Promise.all([
      db.user.findMany({
        where: { isActive: true, hasLoginAccess: true },
        select: {
          id: true,
          name: true,
          createdAt: true,
          terminationDate: true,
          isActive: true,
          hasLoginAccess: true,
        },
        orderBy: { name: "asc" },
      }),
      db.workLog.findMany({
        where: { workDate: { gte: rangeStart, lte: rangeEnd } },
        select: { userId: true, workDate: true, hours: true },
      }),
      db.scheduleException.findMany({
        where: { startDate: { lte: rangeEnd }, endDate: { gte: rangeStart } },
        select: { userId: true, startDate: true, endDate: true },
      }),
      db.workWeekFlag.findMany({
        where: { weekKey: { in: weekKeys } },
        select: { userId: true, weekKey: true, overtimeApproved: true },
      }),
    ]);

    const flagKey = (userId: string, weekKey: string) => `${userId}:${weekKey}`;
    const flagMap = new Map(flags.map((f) => [flagKey(f.userId, f.weekKey), f.overtimeApproved]));

    const rows: Record<string, unknown>[] = [];
    let overtimeWeeks = 0;
    let unapprovedOvertimeWeeks = 0;

    for (const weekKey of weekKeys) {
      const { start, end } = weekBounds(weekKey);
      const isCurrent = weekKey === currentKey;

      for (const user of users) {
        const windowUser = { ...user, startDate: user.createdAt };
        const expected = expectedWorkdays(start, isCurrent ? { upTo: today } : {}).filter((d) =>
          rosterWindow(windowUser, d)
        );
        const userExceptions = exceptions.filter(
          (e) => e.userId === user.id || e.userId === null
        );
        const owed = expected.filter((d) => !isExceptedDay(d, userExceptions));
        const userLogs = logs.filter(
          (l) =>
            l.userId === user.id &&
            l.workDate.getTime() >= start.getTime() &&
            l.workDate.getTime() <= end.getTime()
        );
        if (owed.length === 0 && userLogs.length === 0) continue;

        const totals = weekTotals(userLogs);
        const overtimeHours =
          Math.round(Math.max(0, totals.totalHours - OVERTIME_WEEK_HOURS) * 100) / 100;
        const otApproved = flagMap.get(flagKey(user.id, weekKey)) ?? false;
        if (overtimeHours > 0) {
          overtimeWeeks++;
          if (!otApproved) unapprovedOvertimeWeeks++;
        }

        rows.push({
          week: weekKey,
          name: user.name,
          days: `${totals.days}/${owed.length}`,
          totalHours: totals.totalHours,
          overtimeHours,
          otApproved: overtimeHours > 0 ? (otApproved ? "Approved" : "NOT approved") : "—",
        });
      }
    }

    return {
      summary:
        `${users.length} active employees × ${WEEKS} weeks (${weekKeys[WEEKS - 1]} → ${weekKeys[0]}, current week counted up to today)` +
        ` · ${overtimeWeeks} person-week${overtimeWeeks === 1 ? "" : "s"} over ${OVERTIME_WEEK_HOURS}h` +
        (overtimeWeeks > 0 ? ` (${unapprovedOvertimeWeeks} unapproved)` : "") +
        ".",
      columns: [
        { key: "week", label: "Week" },
        { key: "name", label: "Employee" },
        { key: "days", label: "Days (logged/expected)", align: "right" },
        {
          key: "totalHours",
          label: "Total hours",
          align: "right",
          format: (v) => (typeof v === "number" ? v.toFixed(1) : String(v)),
        },
        {
          key: "overtimeHours",
          label: "Overtime hours",
          align: "right",
          format: (v) => (typeof v === "number" && v > 0 ? v.toFixed(1) : "—"),
        },
        { key: "otApproved", label: "OT approved" },
      ],
      rows,
      emptyMessage: "No work logs recorded in the last 4 weeks.",
    };
  },
};
