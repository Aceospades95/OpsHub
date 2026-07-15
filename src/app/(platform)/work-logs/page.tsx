import { db } from "@/lib/db";
import { requireAuth, resolveModulePerms } from "@/lib/permissions";
import { AccessDenied } from "@/components/shared/access-denied";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { Users } from "lucide-react";
import type { ScheduleException, WorkLog } from "@prisma/client";
import { formatCalendarDate, toCalendarDateString } from "@/lib/dates";
import {
  OVERTIME_WEEK_HOURS,
  canManageWorkLogs,
  expectedWorkdays,
  isoWeekKey,
  shiftWeekKey,
  startOfUtcDay,
  utcWeekdayName,
  weekBounds,
  weekTotals,
} from "@/lib/worklogs";
import { QuickLogForm } from "./quick-log-form";
import { SubmitLogButton } from "./submit-log-button";

export const metadata = { title: "Work Logs · OpsHub" };

/**
 * MY work-log week. Everyone with work-logs canView sees exactly their
 * own data here (self-scoped by construction — every query filters on
 * the session user). The team matrix lives at /work-logs/team behind
 * canManage.
 */
export default async function WorkLogsPage() {
  const user = await requireAuth();
  const perms = await resolveModulePerms(user.id, user.role, "work-logs");
  if (!perms.canView) {
    return (
      <AccessDenied
        module="work-logs"
        moduleLabel="Work Logs"
        moduleDescription="Daily technician work logs, schedule exceptions, and weekly hour roll-ups"
      />
    );
  }

  const canManage = canManageWorkLogs(user.role, perms);
  const today = startOfUtcDay(new Date());
  const todayStr = toCalendarDateString(today);
  const currentKey = isoWeekKey(today);
  const { start: currentStart, end: currentEnd } = weekBounds(currentKey);
  const lastKey = shiftWeekKey(currentKey, -1);
  const { start: lastStart, end: lastEnd } = weekBounds(lastKey);
  // Totals strip: the current week plus the three before it.
  const stripKeys = [currentKey, lastKey, shiftWeekKey(currentKey, -2), shiftWeekKey(currentKey, -3)];
  const rangeStart = weekBounds(stripKeys[3]).start;

  const [me, logs, exceptions, flags] = await Promise.all([
    db.user.findUnique({
      where: { id: user.id },
      select: { workLogRequired: true },
    }),
    db.workLog.findMany({
      where: { userId: user.id, workDate: { gte: rangeStart, lte: currentEnd } },
      orderBy: { workDate: "asc" },
    }),
    db.scheduleException.findMany({
      where: {
        OR: [{ userId: user.id }, { userId: null }],
        startDate: { lte: currentEnd },
        endDate: { gte: rangeStart },
      },
    }),
    db.workWeekFlag.findMany({ where: { userId: user.id, weekKey: { in: stripKeys } } }),
  ]);

  const logByDay = new Map<string, WorkLog>(logs.map((l) => [toCalendarDateString(l.workDate), l]));
  const flagByWeek = new Map(flags.map((f) => [f.weekKey, f]));

  const exceptionFor = (day: Date): ScheduleException | undefined =>
    exceptions.find(
      (e) =>
        startOfUtcDay(e.startDate).getTime() <= day.getTime() &&
        startOfUtcDay(e.endDate).getTime() >= day.getTime()
    );

  const weekLabel = (start: Date, end: Date) =>
    `${formatCalendarDate(start, "MMM d")} – ${formatCalendarDate(end, "MMM d, yyyy")}`;

  const dayCell = (day: Date) => {
    const dayStr = toCalendarDateString(day);
    const log = logByDay.get(dayStr);
    const exception = exceptionFor(day);
    const isFuture = day.getTime() > today.getTime();

    if (log) {
      return (
        <div className="space-y-1">
          <div className="flex items-center justify-between gap-1">
            <span className="font-semibold tabular-nums">{log.hours}h</span>
            {perms.canCreate && (
              <SubmitLogButton
                date={dayStr}
                existing={{ hours: log.hours, sites: log.sites, notes: log.notes }}
                maxDate={todayStr}
              />
            )}
          </div>
          {log.sites && (
            <p className="text-xs text-muted-foreground truncate" title={log.sites}>
              {log.sites}
            </p>
          )}
          {exception && (
            <Badge variant="secondary" className="text-[10px]">
              {exception.type}
            </Badge>
          )}
        </div>
      );
    }
    if (exception) {
      return (
        <div className="space-y-1">
          <Badge variant="secondary">{exception.type}</Badge>
          {!exception.approved && (
            <p className="text-[10px] text-muted-foreground">unapproved</p>
          )}
        </div>
      );
    }
    if (isFuture) {
      return <span className="text-muted-foreground">—</span>;
    }
    return (
      <div className="flex items-center justify-between gap-1">
        <span className="text-destructive font-medium">Missing</span>
        {perms.canCreate && <SubmitLogButton date={dayStr} maxDate={todayStr} />}
      </div>
    );
  };

  const weekGrid = (weekStart: Date) => {
    const days = expectedWorkdays(weekStart);
    return (
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted-foreground">
              {days.map((day) => {
                const isToday = day.getTime() === today.getTime();
                return (
                  <th key={day.toISOString()} className="p-3 font-medium min-w-[9rem]">
                    {utcWeekdayName(day)} {formatCalendarDate(day, "MMM d")}
                    {isToday && (
                      <Badge variant="outline" className="ml-2 text-[10px]">
                        Today
                      </Badge>
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            <tr>
              {days.map((day) => (
                <td key={day.toISOString()} className="p-3 align-top">
                  {dayCell(day)}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
    );
  };

  const weekLogsFor = (key: string) => {
    const bounds = weekBounds(key);
    return logs.filter(
      (l) => l.workDate.getTime() >= bounds.start.getTime() && l.workDate.getTime() <= bounds.end.getTime()
    );
  };

  return (
    <div>
      <PageHeader
        title="Work Logs"
        description="Your daily log — hours, tickets/sites, and notes. Back-fill missing days before the week closes."
        actions={
          canManage ? (
            <Link href="/work-logs/team">
              <Button variant="outline">
                <Users className="h-4 w-4 mr-2" /> Team view
              </Button>
            </Link>
          ) : undefined
        }
      />

      {!me?.workLogRequired && (
        <div className="mb-6 rounded border border-border bg-muted/40 px-4 py-3 text-xs text-muted-foreground">
          You&apos;re not enrolled in daily work logs, so nothing here is
          required of you and no reminders will be sent — you can still log
          days voluntarily. Managers enroll people from the Team view.
        </div>
      )}

      {/* 4-week totals strip */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 mb-6">
        {stripKeys.map((key) => {
          const totals = weekTotals(weekLogsFor(key));
          const isOvertime = totals.totalHours > OVERTIME_WEEK_HOURS;
          const flag = flagByWeek.get(key);
          return (
            <Card key={key}>
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground">
                  {key}
                  {key === currentKey && " · this week"}
                </p>
                <p className="text-2xl font-bold tabular-nums">{totals.totalHours}h</p>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span>
                    {totals.days} day{totals.days === 1 ? "" : "s"} logged
                  </span>
                  {isOvertime &&
                    (flag?.overtimeApproved ? (
                      <Badge variant="success">OT approved</Badge>
                    ) : (
                      <Badge variant="destructive">
                        +{Math.round((totals.totalHours - OVERTIME_WEEK_HOURS) * 100) / 100}h OT
                      </Badge>
                    ))}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          {/* Current week */}
          <Card>
            <CardContent className="p-0">
              <div className="p-4 border-b border-border">
                <h2 className="font-semibold">This week</h2>
                <p className="text-xs text-muted-foreground">
                  {currentKey} · {weekLabel(currentStart, currentEnd)}
                </p>
              </div>
              {weekGrid(currentStart)}
            </CardContent>
          </Card>

          {/* Last week — still back-fillable while this week is in progress */}
          <Card>
            <CardContent className="p-0">
              <div className="p-4 border-b border-border">
                <h2 className="font-semibold">Last week</h2>
                <p className="text-xs text-muted-foreground">
                  {lastKey} · {weekLabel(lastStart, lastEnd)} · back-fill stays open until this
                  week ends ({formatCalendarDate(currentEnd, "MMM d")})
                </p>
              </div>
              {weekGrid(lastStart)}
            </CardContent>
          </Card>
        </div>

        {/* Quick submit */}
        <div>
          <Card>
            <CardContent className="p-4">
              <h2 className="font-semibold mb-1">Log a day</h2>
              <p className="text-xs text-muted-foreground mb-4">
                Defaults to today. Submitting a day you already logged updates it.
              </p>
              {perms.canCreate ? (
                <QuickLogForm
                  today={todayStr}
                  minDate={canManage ? undefined : toCalendarDateString(lastStart)}
                />
              ) : (
                <p className="text-sm text-muted-foreground">
                  You don&apos;t have permission to submit logs.
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
