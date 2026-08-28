/**
 * work-log-reminders
 *
 * The daily engine behind the work-log module — replaces the reminder
 * sheet's "Reminder sent (1/5 days)" automation, minus its pain points:
 *
 *   - Exceptions-aware: PTO / sick / holiday days (ScheduleException,
 *     own or org-wide) count as satisfied — nobody gets nagged from a
 *     sick bed.
 *   - Roster-aware: inactive / no-login users are excluded outright;
 *     terminationDate and the row-creation date clip which days a
 *     person is expected for (the User model has no hire-date column,
 *     so createdAt stands in — someone added Wednesday isn't "missing"
 *     Monday).
 *   - Duplicate submissions can't double count (DB unique + upsert).
 *
 * Daily: each roster user with missing days — current week up to
 * (today - graceDays), plus anything still missing from LAST week
 * while it's back-fillable — gets ONE "work-log-reminder".
 *
 * Reminder notifications carry entityType "work-log-week" and entityId
 * "<userId>:<currentWeekKey>", so the notification RULE layer's
 * throttle has something to key on: setting throttleHours ≈ 20 on the
 * work-log-reminder rule makes reminders at-most-daily per person-week
 * even if the job is re-run manually.
 *
 * Mondays additionally close out LAST week:
 *   - Freeze WorkLogWeekSnapshot per roster user (expected / submitted
 *     / hours). expectedDays is post-exception (days they truly owed).
 *     The team view renders frozen vs live so late back-fills show as
 *     a delta instead of silently rewriting history. If a Monday run
 *     was missed, the next daily run writes catch-up snapshots for
 *     rows that don't exist yet (never overwriting existing ones).
 *   - If anyone is still missing days for last week, ONE
 *     "work-log-escalation" goes to active admins + managers listing
 *     who is behind.
 *
 * EXPLAINABILITY — the output is a per-person ledger: who was reminded
 * and for which days, whose days were excused by which exception, who
 * came up clean, and exactly who was EXCLUDED from the roster and why.
 * Supports ctx.dryRun: evaluates and explains, sends/writes nothing.
 */

import { db } from "@/lib/db";
import { log } from "@/lib/log";
import { notify } from "@/lib/notifications";
import { absoluteUrl } from "@/lib/url";
import { formatCalendarDate } from "@/lib/dates";
import {
  addUtcDays,
  expectedWorkdays,
  isExceptedDay,
  isoWeekKey,
  missingDays,
  rosterWindow,
  shiftWeekKey,
  startOfUtcDay,
  utcWeekdayName,
  weekBounds,
  weekTotals,
} from "@/lib/worklogs";
import { getJobParams } from "../params";
import { shouldRunDaily } from "../gating";
import type { JobDefinition } from "../types";

const PARAM_DEFAULTS = {
  graceDays: 1,
};

/** "Mon Jul 6, Tue Jul 7" — UTC-stable day list for messages. */
function dayList(days: Date[]): string {
  return days.map((d) => `${utcWeekdayName(d)} ${formatCalendarDate(d, "MMM d")}`).join(", ");
}

export const workLogReminders: JobDefinition = {
  key: "work-log-reminders",
  name: "Work log reminders",
  description:
    "Reminds technicians about missing daily work logs (PTO/sick/holiday and roster changes honored); Mondays it freezes last week's snapshots and escalates anyone still behind to admins + managers",
  schedule: "Daily",
  notificationTypes: ["work-log-reminder", "work-log-escalation"],
  supportsDryRun: true,
  paramsSchema: [
    {
      key: "graceDays",
      label: "Grace period (days)",
      type: "number",
      min: 0,
      defaultValue: 1,
      help: "Don't remind about a day until it's this many days old (1 = start nagging the day after)",
    },
  ],

  async handler(ctx) {
    // Dry runs always evaluate — the point of a preview is to see what
    // the next real run would do, even right after one completed.
    if (!ctx.dryRun && !(await shouldRunDaily("work-log-reminders"))) {
      return { status: "skipped", output: "Already ran today", processed: 0 };
    }
    const params = await getJobParams("work-log-reminders", PARAM_DEFAULTS);
    const graceDays = Math.max(0, Math.floor(params.graceDays));

    const today = startOfUtcDay(new Date());
    const isMonday = today.getUTCDay() === 1;
    // A day is nag-eligible once it's graceDays old.
    const cutoff = addUtcDays(today, -graceDays);

    const currentKey = isoWeekKey(today);
    const currentBounds = weekBounds(currentKey);
    const lastKey = shiftWeekKey(currentKey, -1);
    const lastBounds = weekBounds(lastKey);

    const [allUsers, logs, exceptions, existingSnapshots, office] = await Promise.all([
      db.user.findMany({
        // Only ENROLLED people are evaluated at all (workLogRequired is
        // the opt-in roster — the launch default of "everyone" mass
        // reminded the whole company on the first cold-start run).
        where: { workLogRequired: true },
        select: {
          id: true,
          name: true,
          isActive: true,
          hasLoginAccess: true,
          workLogRequired: true,
          workLogRequiredSince: true,
          terminationDate: true,
          createdAt: true,
        },
        orderBy: { name: "asc" },
      }),
      db.workLog.findMany({
        where: { workDate: { gte: lastBounds.start, lte: currentBounds.end } },
        select: { userId: true, workDate: true, hours: true },
      }),
      db.scheduleException.findMany({
        where: { startDate: { lte: currentBounds.end }, endDate: { gte: lastBounds.start } },
        select: { userId: true, startDate: true, endDate: true, type: true },
      }),
      db.workLogWeekSnapshot.findMany({
        where: { weekKey: lastKey },
        select: { userId: true },
      }),
      db.user.findMany({
        where: { isActive: true, role: { in: ["ADMIN", "MANAGER"] } },
        select: { id: true, name: true },
      }),
    ]);

    const logsByUser = new Map<string, { workDate: Date; hours: number }[]>();
    for (const row of logs) {
      logsByUser.set(row.userId, [...(logsByUser.get(row.userId) ?? []), row]);
    }
    const snapshotExists = new Set(existingSnapshots.map((s) => s.userId));

    const detail: string[] = [];
    const excludedLines: string[] = [];
    let remindersSent = 0;
    let cleanCount = 0;
    let snapshotsWritten = 0;
    let escalationsSent = 0;

    const behindLastWeek: { userId: string; name: string; missing: Date[] }[] = [];
    const snapshotWrites: {
      userId: string;
      name: string;
      expectedDays: number;
      submittedDays: number;
      totalHours: number;
      catchUp: boolean;
    }[] = [];

    for (const user of allUsers) {
      // ── Roster gate, with the WHY recorded ─────────────────────────
      if (!user.isActive) {
        excludedLines.push(`· EXCLUDED ${user.name} — inactive`);
        continue;
      }
      if (!user.hasLoginAccess) {
        excludedLines.push(`· EXCLUDED ${user.name} — no login access (placeholder account)`);
        continue;
      }

      const windowUser = { ...user, startDate: user.createdAt };
      // (workLogRequired is guaranteed true by the query; the window
      // still honors workLogRequiredSince so mid-week enrollment never
      // retro-nags earlier days.)
      const currentExpected = expectedWorkdays(currentBounds.start, { upTo: cutoff }).filter((d) =>
        rosterWindow(windowUser, d)
      );
      const lastExpected = expectedWorkdays(lastBounds.start).filter((d) =>
        rosterWindow(windowUser, d)
      );

      const userLogs = logsByUser.get(user.id) ?? [];
      const userExceptions = exceptions.filter((e) => e.userId === user.id || e.userId === null);
      const lastWeekLogs = userLogs.filter((l) => l.workDate.getTime() <= lastBounds.end.getTime());

      if (currentExpected.length === 0 && lastExpected.length === 0) {
        if (user.terminationDate && startOfUtcDay(user.terminationDate).getTime() < lastBounds.start.getTime()) {
          excludedLines.push(
            `· EXCLUDED ${user.name} — terminated ${formatCalendarDate(user.terminationDate, "MMM d, yyyy")}`
          );
        } else if (startOfUtcDay(user.createdAt).getTime() > cutoff.getTime()) {
          excludedLines.push(
            `· EXCLUDED ${user.name} — not started until ${formatCalendarDate(user.createdAt, "MMM d, yyyy")}; nothing due yet`
          );
        } else {
          excludedLines.push(`· EXCLUDED ${user.name} — no workdays due in the evaluation window`);
        }
        continue;
      }

      // ── Missing days: last week (still back-fillable) + this week ──
      const missingLast = missingDays({
        weekDates: lastExpected,
        logs: userLogs,
        exceptions: userExceptions,
      });
      const missingCurrent = missingDays({
        weekDates: currentExpected,
        logs: userLogs,
        exceptions: userExceptions,
      });
      const allMissing = [...missingLast, ...missingCurrent];
      const exceptedDays = [...lastExpected, ...currentExpected].filter((d) =>
        isExceptedDay(d, userExceptions)
      );
      const exceptedNote =
        exceptedDays.length > 0
          ? `; ${exceptedDays.length} excepted day${exceptedDays.length === 1 ? "" : "s"} honored`
          : "";

      if (missingLast.length > 0) {
        behindLastWeek.push({ userId: user.id, name: user.name, missing: missingLast });
      }

      if (allMissing.length === 0) {
        cleanCount++;
        const dueCount = lastExpected.length + currentExpected.length - exceptedDays.length;
        detail.push(`· ${user.name}: clean (${dueCount} due, all logged${exceptedNote})`);
      } else {
        const days = dayList(allMissing);
        if (ctx.dryRun) {
          remindersSent++;
          detail.push(
            `→ ${user.name}: ${allMissing.length} missing (${days})${exceptedNote} — WOULD remind`
          );
        } else {
          try {
            await notify({
              recipientId: user.id,
              type: "work-log-reminder",
              title: `Work log reminder: ${allMissing.length} day${allMissing.length === 1 ? "" : "s"} missing`,
              body: `${days}. Back-fill on the Work Logs page before the week closes.`,
              href: "/work-logs",
              entityType: "work-log-week",
              entityId: `${user.id}:${currentKey}`,
              email: {
                templateKey: "notification",
                data: {
                  recipientName: user.name,
                  heading: "Daily work log reminder",
                  body: `You're ${allMissing.length} workday${allMissing.length === 1 ? "" : "s"} behind — ${days}. Back-fill on the Work Logs page; last week's days close when this week ends (${formatCalendarDate(currentBounds.end, "MMM d")}).`,
                  cta: { label: "Open work logs", url: absoluteUrl("/work-logs") },
                },
              },
            });
            remindersSent++;
            detail.push(
              `→ ${user.name}: ${allMissing.length} missing (${days})${exceptedNote} — reminded`
            );
          } catch (err) {
            log.error("jobs.workLogReminders", "Notify failed", err, { userId: user.id });
            detail.push(
              `→ ${user.name}: ${allMissing.length} missing (${days}) — reminder FAILED (see logs)`
            );
          }
        }
      }

      // ── Snapshot bookkeeping for last week ─────────────────────────
      // Mondays freeze everyone; other days only back-fill rows that a
      // missed Monday never wrote (never overwriting a frozen value).
      if (lastExpected.length > 0 || lastWeekLogs.length > 0) {
        const catchUp = !isMonday && !snapshotExists.has(user.id);
        if (isMonday || catchUp) {
          const owedDays = lastExpected.filter((d) => !isExceptedDay(d, userExceptions));
          snapshotWrites.push({
            userId: user.id,
            name: user.name,
            expectedDays: owedDays.length,
            submittedDays: lastWeekLogs.length,
            totalHours: weekTotals(lastWeekLogs).totalHours,
            catchUp,
          });
        }
      }
    }

    // ── Monday close-out: freeze snapshots ───────────────────────────
    if (snapshotWrites.length > 0) {
      for (const snap of snapshotWrites) {
        if (ctx.dryRun) {
          snapshotsWritten++;
          detail.push(
            `→ snapshot ${lastKey} · ${snap.name}: WOULD freeze ${snap.submittedDays}/${snap.expectedDays} days, ${snap.totalHours}h${snap.catchUp ? " (catch-up for a missed Monday)" : ""}`
          );
          continue;
        }
        try {
          await db.workLogWeekSnapshot.upsert({
            where: { weekKey_userId: { weekKey: lastKey, userId: snap.userId } },
            update: {
              expectedDays: snap.expectedDays,
              submittedDays: snap.submittedDays,
              totalHours: snap.totalHours,
              snapshotAt: new Date(),
            },
            create: {
              weekKey: lastKey,
              userId: snap.userId,
              expectedDays: snap.expectedDays,
              submittedDays: snap.submittedDays,
              totalHours: snap.totalHours,
            },
          });
          snapshotsWritten++;
          detail.push(
            `→ snapshot ${lastKey} · ${snap.name}: froze ${snap.submittedDays}/${snap.expectedDays} days, ${snap.totalHours}h${snap.catchUp ? " (catch-up for a missed Monday)" : ""}`
          );
        } catch (err) {
          log.error("jobs.workLogReminders", "Snapshot write failed", err, {
            userId: snap.userId,
            weekKey: lastKey,
          });
        }
      }
    } else if (isMonday) {
      detail.push(`· snapshot ${lastKey}: nobody to freeze`);
    } else {
      detail.push(
        `· Monday close-out: skipped (today is ${utcWeekdayName(today)}); ${lastKey} snapshots ${existingSnapshots.length > 0 ? "already frozen" : "will freeze next Monday"}`
      );
    }

    // ── Monday escalation: one summary to admins + managers ──────────
    if (isMonday && behindLastWeek.length > 0) {
      const summaryList = behindLastWeek
        .map((b) => `${b.name} (${b.missing.length}d)`)
        .join(", ");
      if (office.length === 0) {
        detail.push(`→ escalation ${lastKey}: ${summaryList} — SKIPPED, no active admins/managers`);
      } else if (ctx.dryRun) {
        escalationsSent++;
        detail.push(
          `→ escalation ${lastKey}: ${behindLastWeek.length} behind (${summaryList}) — WOULD notify ${office.length} admin${office.length === 1 ? "" : "s"}/manager${office.length === 1 ? "" : "s"}`
        );
      } else {
        try {
          await notify({
            recipientId: office.map((o) => o.id),
            type: "work-log-escalation",
            title: `Work logs: ${behindLastWeek.length} ${behindLastWeek.length === 1 ? "person" : "people"} behind for ${lastKey}`,
            body: summaryList,
            href: `/work-logs/team?week=${lastKey}`,
            entityType: "work-log-week",
            entityId: lastKey,
            email: {
              templateKey: "notification",
              data: {
                recipientName: "team", // personalized per recipient by notify()
                heading: `Work logs behind — ${lastKey}`,
                body: `${behindLastWeek.length} ${behindLastWeek.length === 1 ? "person is" : "people are"} still missing last week's daily logs: ${summaryList}. Exceptions (PTO/sick/holiday) are already accounted for.`,
                cta: {
                  label: "Open team view",
                  url: absoluteUrl(`/work-logs/team?week=${lastKey}`),
                },
              },
            },
          });
          escalationsSent++;
          detail.push(
            `→ escalation ${lastKey}: ${behindLastWeek.length} behind (${summaryList}) — notified ${office.length} admin${office.length === 1 ? "" : "s"}/manager${office.length === 1 ? "" : "s"}`
          );
        } catch (err) {
          log.error("jobs.workLogReminders", "Escalation notify failed", err, { weekKey: lastKey });
          detail.push(`→ escalation ${lastKey}: FAILED (see logs)`);
        }
      }
    } else if (isMonday) {
      detail.push(`· escalation ${lastKey}: nobody behind — not sent`);
    }

    const verb = ctx.dryRun ? "would send" : "sent";
    const summary = [
      `Roster: ${allUsers.length} enrolled (only people with "Submits work logs" turned on at /work-logs/team are ever evaluated or reminded).`,
      ...(allUsers.length === 0
        ? [`Nobody is enrolled yet — enroll your technicians on /work-logs/team and this job starts watching them.`]
        : []),
      `Evaluated ${currentKey} (up to ${formatCalendarDate(cutoff, "MMM d")}, grace ${graceDays}d) + still-open ${lastKey}: ${verb} ${remindersSent} reminder${remindersSent === 1 ? "" : "s"}, ${cleanCount} clean, ${excludedLines.length} excluded from the roster; ${ctx.dryRun ? "would freeze" : "froze"} ${snapshotsWritten} snapshot${snapshotsWritten === 1 ? "" : "s"}, ${verb} ${escalationsSent} escalation${escalationsSent === 1 ? "" : "s"}.`,
      `Reminders key on entityId "<userId>:<weekKey>" — set a ~20h throttle on the work-log-reminder notification rule to make them at-most-daily per person even across manual re-runs.`,
      ...(detail.length > 0 ? ["", ...detail] : []),
      ...(excludedLines.length > 0 ? ["", "Roster exclusions:", ...excludedLines] : []),
    ].join("\n");

    return { output: summary, processed: remindersSent + escalationsSent };
  },
};
