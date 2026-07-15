import { db } from "@/lib/db";
import { requireAuth, resolveModulePerms } from "@/lib/permissions";
import { redirect } from "next/navigation";
import Link from "next/link";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { formatCalendarDate, toCalendarDateString } from "@/lib/dates";
import {
  OVERTIME_WEEK_HOURS,
  canManageWorkLogs,
  expectedWorkdays,
  isValidWeekKey,
  isoWeekKey,
  missingDays,
  rosterWindow,
  shiftWeekKey,
  startOfUtcDay,
  utcWeekdayName,
  weekBounds,
  weekTotals,
} from "@/lib/worklogs";
import { ApproveOtButton } from "./approve-ot-button";
import { AddExceptionButton, DeleteExceptionButton } from "./exception-buttons";

export const metadata = { title: "Team Work Logs · OpsHub" };

/**
 * The manager matrix: active roster × weekdays for one ISO week
 * (?week=2026-W28, default current). canManage only — this page shows
 * everyone's hours, exceptions, and overtime state.
 *
 * Roster hygiene mirrors the reminders job: inactive / no-login users
 * never appear, and termination / row-creation dates clip which days a
 * person is expected for — the "reassigned/terminated people polluted
 * the roster" fix.
 */
export default async function TeamWorkLogsPage({
  searchParams,
}: {
  searchParams: { week?: string };
}) {
  const user = await requireAuth();
  const perms = await resolveModulePerms(user.id, user.role, "work-logs");
  if (!canManageWorkLogs(user.role, perms)) redirect("/work-logs");

  const today = startOfUtcDay(new Date());
  const currentKey = isoWeekKey(today);
  const weekKey = isValidWeekKey(searchParams.week) ? searchParams.week! : currentKey;
  const { start, end } = weekBounds(weekKey);
  const weekdays = expectedWorkdays(start);
  const isCurrentWeek = weekKey === currentKey;
  const isFutureWeek = start.getTime() > weekBounds(currentKey).start.getTime();

  const [users, logs, exceptions, flags, snapshots] = await Promise.all([
    db.user.findMany({
      where: { isActive: true, hasLoginAccess: true },
      select: { id: true, name: true, createdAt: true, terminationDate: true, isActive: true, hasLoginAccess: true },
      orderBy: { name: "asc" },
    }),
    db.workLog.findMany({ where: { workDate: { gte: start, lte: end } } }),
    db.scheduleException.findMany({
      where: { startDate: { lte: end }, endDate: { gte: start } },
      include: {
        user: { select: { id: true, name: true } },
        createdBy: { select: { name: true } },
      },
      orderBy: [{ startDate: "asc" }],
    }),
    db.workWeekFlag.findMany({ where: { weekKey } }),
    db.workLogWeekSnapshot.findMany({ where: { weekKey } }),
  ]);

  // Only people who count for at least one weekday of THIS week.
  const roster = users.filter((u) =>
    weekdays.some((d) => rosterWindow({ ...u, startDate: u.createdAt }, d))
  );

  const flagByUser = new Map(flags.map((f) => [f.userId, f]));
  const snapshotByUser = new Map(snapshots.map((s) => [s.userId, s]));
  const logsByUser = new Map<string, typeof logs>();
  for (const log of logs) {
    logsByUser.set(log.userId, [...(logsByUser.get(log.userId) ?? []), log]);
  }

  const exceptionsFor = (userId: string) =>
    exceptions.filter((e) => e.userId === userId || e.userId === null);

  const rows = roster.map((member) => {
    const memberLogs = logsByUser.get(member.id) ?? [];
    const memberExceptions = exceptionsFor(member.id);
    const expected = weekdays.filter((d) =>
      rosterWindow({ ...member, startDate: member.createdAt }, d)
    );
    // Only past days can be "missing" — mid-week the future half of the
    // week is simply not due yet.
    const dueSoFar = expected.filter((d) => d.getTime() <= today.getTime());
    const missing = missingDays({
      weekDates: dueSoFar,
      logs: memberLogs,
      exceptions: memberExceptions,
    });
    const totals = weekTotals(memberLogs);
    const flag = flagByUser.get(member.id);
    const snapshot = snapshotByUser.get(member.id) ?? null;
    return { member, memberLogs, memberExceptions, expected, missing, totals, flag, snapshot };
  });

  const behindCount = rows.filter((r) => r.missing.length > 0).length;
  const overtimeRows = rows.filter((r) => r.totals.totalHours > OVERTIME_WEEK_HOURS);
  const unapprovedOvertime = overtimeRows.filter((r) => !r.flag?.overtimeApproved).length;
  const hasSnapshots = snapshots.length > 0;
  const snapshotAt = hasSnapshots
    ? snapshots.reduce((min, s) => (s.snapshotAt < min ? s.snapshotAt : min), snapshots[0].snapshotAt)
    : null;

  const weekHref = (key: string) => `/work-logs/team?week=${key}`;

  const dayCell = (row: (typeof rows)[number], day: Date) => {
    const log = row.memberLogs.find(
      (l) => startOfUtcDay(l.workDate).getTime() === day.getTime()
    );
    if (log) {
      return (
        <span className="font-medium tabular-nums" title={log.sites ?? undefined}>
          {log.hours}h
        </span>
      );
    }
    const inWindow = rosterWindow({ ...row.member, startDate: row.member.createdAt }, day);
    if (!inWindow) {
      return (
        <span className="text-muted-foreground" title="Not on the roster for this day">
          n/a
        </span>
      );
    }
    const exception = row.memberExceptions.find(
      (e) =>
        startOfUtcDay(e.startDate).getTime() <= day.getTime() &&
        startOfUtcDay(e.endDate).getTime() >= day.getTime()
    );
    if (exception) {
      return (
        <Badge variant={exception.approved ? "secondary" : "warning"} className="text-[10px]">
          {exception.type}
          {!exception.approved && "?"}
        </Badge>
      );
    }
    if (day.getTime() > today.getTime()) {
      return <span className="text-muted-foreground">—</span>;
    }
    return <span className="text-destructive font-medium">Missing</span>;
  };

  return (
    <div>
      <PageHeader
        title="Team Work Logs"
        description="Who's logged what this week — exceptions honored, overtime flagged"
        actions={
          <div className="flex items-center gap-2">
            <AddExceptionButton
              users={users.map((u) => ({ id: u.id, name: u.name }))}
              defaultStart={toCalendarDateString(start)}
            />
            <Link href="/work-logs">
              <Button variant="outline" size="sm">
                My logs
              </Button>
            </Link>
          </div>
        }
      />

      {/* Week picker */}
      <div className="flex flex-wrap items-center gap-2 mb-6">
        <Link href={weekHref(shiftWeekKey(weekKey, -1))}>
          <Button variant="outline" size="sm">
            <ChevronLeft className="h-4 w-4" /> {shiftWeekKey(weekKey, -1)}
          </Button>
        </Link>
        <div className="px-3 py-1.5 rounded border border-border text-sm font-medium">
          {weekKey} · {formatCalendarDate(start, "MMM d")} –{" "}
          {formatCalendarDate(end, "MMM d, yyyy")}
          {isCurrentWeek && (
            <Badge variant="outline" className="ml-2">
              This week
            </Badge>
          )}
        </div>
        {!isFutureWeek && !isCurrentWeek && (
          <Link href={weekHref(shiftWeekKey(weekKey, 1))}>
            <Button variant="outline" size="sm">
              {shiftWeekKey(weekKey, 1)} <ChevronRight className="h-4 w-4" />
            </Button>
          </Link>
        )}
        {!isCurrentWeek && (
          <Link href={weekHref(currentKey)}>
            <Button variant="ghost" size="sm">
              Jump to this week
            </Button>
          </Link>
        )}
        <div className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
          <span>
            {roster.length} on roster · {behindCount} behind
            {overtimeRows.length > 0 &&
              ` · ${overtimeRows.length} over ${OVERTIME_WEEK_HOURS}h (${unapprovedOvertime} unapproved)`}
          </span>
        </div>
      </div>

      {hasSnapshots && (
        <p className="text-xs text-muted-foreground mb-3">
          Frozen snapshot taken {formatCalendarDate(snapshotAt, "MMM d, yyyy")} (Monday close-out).
          The Snapshot column shows the frozen numbers; Δ is what changed since — late back-fills
          stay visible instead of silently rewriting history.
        </p>
      )}

      {/* Matrix */}
      <Card className="mb-8">
        <CardContent className="p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted-foreground">
                <th className="p-3 font-medium min-w-[10rem]">Employee</th>
                {weekdays.map((day) => (
                  <th key={day.toISOString()} className="p-3 font-medium">
                    {utcWeekdayName(day)} {formatCalendarDate(day, "MMM d")}
                  </th>
                ))}
                <th className="p-3 font-medium text-right">Week total</th>
                {hasSnapshots && <th className="p-3 font-medium">Snapshot (frozen)</th>}
                <th className="p-3 font-medium">Overtime</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const { member, totals, flag, snapshot } = row;
                const overtimeHours =
                  Math.round((totals.totalHours - OVERTIME_WEEK_HOURS) * 100) / 100;
                const deltaDays = snapshot ? totals.days - snapshot.submittedDays : 0;
                const deltaHours = snapshot
                  ? Math.round((totals.totalHours - snapshot.totalHours) * 100) / 100
                  : 0;
                return (
                  <tr key={member.id} className="border-b border-border last:border-0 hover:bg-muted/50">
                    <td className="p-3">
                      <Link href={`/team/${member.id}`} className="font-medium hover:text-primary hover:underline">
                        {member.name}
                      </Link>
                      {row.missing.length > 0 && (
                        <div className="text-xs text-destructive">
                          {row.missing.length} day{row.missing.length === 1 ? "" : "s"} missing
                        </div>
                      )}
                    </td>
                    {weekdays.map((day) => (
                      <td key={day.toISOString()} className="p-3">
                        {dayCell(row, day)}
                      </td>
                    ))}
                    <td className="p-3 text-right tabular-nums">
                      <span className="font-semibold">{totals.totalHours}h</span>
                      <span className="text-xs text-muted-foreground"> / {totals.days}d</span>
                    </td>
                    {hasSnapshots && (
                      <td className="p-3 text-xs">
                        {snapshot ? (
                          <div className="space-y-0.5">
                            <span className="tabular-nums">
                              {snapshot.submittedDays}/{snapshot.expectedDays}d · {snapshot.totalHours}h
                            </span>
                            {deltaDays !== 0 || deltaHours !== 0 ? (
                              <Badge variant="warning" className="ml-1 text-[10px]">
                                Δ {deltaDays >= 0 ? "+" : ""}
                                {deltaDays}d / {deltaHours >= 0 ? "+" : ""}
                                {deltaHours}h
                              </Badge>
                            ) : (
                              <span className="text-muted-foreground ml-1">no change</span>
                            )}
                          </div>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                    )}
                    <td className="p-3">
                      {totals.totalHours > OVERTIME_WEEK_HOURS ? (
                        <div className="flex items-center gap-2">
                          {flag?.overtimeApproved ? (
                            <Badge variant="success">OT approved</Badge>
                          ) : (
                            <Badge variant="destructive">+{overtimeHours}h OT</Badge>
                          )}
                          <ApproveOtButton
                            userId={member.id}
                            weekKey={weekKey}
                            approved={Boolean(flag?.overtimeApproved)}
                          />
                        </div>
                      ) : (
                        <span className="text-muted-foreground text-xs">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={8 + (hasSnapshots ? 1 : 0)} className="p-6 text-center text-sm text-muted-foreground">
                    Nobody on the roster for this week.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {/* Exceptions overlapping this week */}
      <Card>
        <CardContent className="p-0">
          <div className="p-4 border-b border-border flex items-center justify-between">
            <div>
              <h2 className="font-semibold">Schedule exceptions</h2>
              <p className="text-xs text-muted-foreground">
                PTO / sick / holiday ranges overlapping this week. Excepted days never count as
                missing and never trigger reminders.
              </p>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted-foreground">
                  <th className="p-3 font-medium">Who</th>
                  <th className="p-3 font-medium">Type</th>
                  <th className="p-3 font-medium">Dates</th>
                  <th className="p-3 font-medium">Approved</th>
                  <th className="p-3 font-medium">Notes</th>
                  <th className="p-3 font-medium">Added by</th>
                  <th className="p-3 font-medium" />
                </tr>
              </thead>
              <tbody>
                {exceptions.map((exception) => {
                  const range = `${formatCalendarDate(exception.startDate, "MMM d")} – ${formatCalendarDate(exception.endDate, "MMM d, yyyy")}`;
                  const who = exception.user?.name ?? "Everyone (org-wide)";
                  return (
                    <tr key={exception.id} className="border-b border-border last:border-0">
                      <td className="p-3">{exception.user ? who : <Badge variant="outline">{who}</Badge>}</td>
                      <td className="p-3">
                        <Badge variant="secondary">{exception.type}</Badge>
                      </td>
                      <td className="p-3 text-muted-foreground">{range}</td>
                      <td className="p-3">
                        {exception.approved ? (
                          <Badge variant="success">Approved</Badge>
                        ) : (
                          <Badge variant="warning">Needs follow-up</Badge>
                        )}
                      </td>
                      <td className="p-3 text-muted-foreground max-w-[16rem] truncate" title={exception.notes ?? undefined}>
                        {exception.notes || "—"}
                      </td>
                      <td className="p-3 text-muted-foreground">{exception.createdBy.name}</td>
                      <td className="p-3 text-right">
                        <DeleteExceptionButton
                          id={exception.id}
                          label={`${exception.type} ${range} — ${who}`}
                        />
                      </td>
                    </tr>
                  );
                })}
                {exceptions.length === 0 && (
                  <tr>
                    <td colSpan={7} className="p-6 text-center text-sm text-muted-foreground">
                      No exceptions overlap this week. Use “Add exception” for PTO, sick days, or
                      org-wide holidays.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
