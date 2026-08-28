/**
 * task-due-reminders
 *
 * Nudges assignees when an open task's due date is inside the lead
 * window (or already past). Each due date fires at most once —
 * Task.dueNotifiedFor records which dueDate was announced, and a
 * rescheduled task re-arms automatically because the stored date no
 * longer matches (same pattern as BidOpportunity.dueNotifiedFor).
 *
 * Unassigned tasks notify their creator instead — someone has to own
 * the deadline. Recipients/channels/wording are controlled by the
 * "task-due-soon" delivery rule; per-user mutes apply as usual.
 *
 * Supports ctx.dryRun: evaluates and explains, sends/writes nothing.
 */

import { db } from "@/lib/db";
import { log } from "@/lib/log";
import { notify } from "@/lib/notifications";
import { absoluteUrl } from "@/lib/url";
import { shouldRunDaily } from "../gating";
import { getJobParams } from "../params";
import type { JobDefinition } from "../types";

const DEFAULTS = {
  /** Days before the due date reminders start firing. */
  leadDays: 3,
};

export const taskDueReminders: JobDefinition = {
  key: "task-due-reminders",
  name: "Task due reminders",
  description:
    "Reminds assignees (or creators, when unassigned) about open tasks that are due soon or overdue — once per due date",
  schedule: "Daily",
  notificationTypes: ["task-due-soon"],
  supportsDryRun: true,
  paramsSchema: [
    {
      key: "leadDays",
      label: "Lead time (days before due)",
      type: "number",
      min: 0,
      defaultValue: DEFAULTS.leadDays,
      help: "A task due within this many days triggers the reminder. 0 = only on/after the due date.",
    },
  ],

  async handler(ctx) {
    if (!ctx.dryRun && !(await shouldRunDaily("task-due-reminders"))) {
      return { status: "skipped", output: "Already ran today", processed: 0 };
    }
    const { leadDays } = await getJobParams("task-due-reminders", DEFAULTS);
    const now = new Date();
    const horizon = new Date(now.getTime() + leadDays * 24 * 60 * 60 * 1000);

    // Open tasks with a due date inside the window (or already past).
    // dueNotifiedFor is compared in JS — Prisma can't compare two
    // columns in a where clause.
    const candidates = await db.task.findMany({
      where: {
        deletedAt: null,
        status: { in: ["TODO", "IN_PROGRESS"] },
        dueDate: { not: null, lte: horizon },
      },
      select: {
        id: true,
        title: true,
        dueDate: true,
        dueNotifiedFor: true,
        assigneeId: true,
        createdById: true,
        assignee: { select: { id: true, name: true, isActive: true } },
        createdBy: { select: { id: true, name: true, isActive: true } },
      },
      orderBy: { dueDate: "asc" },
    });

    let notified = 0;
    const detail: string[] = [];

    for (const task of candidates) {
      if (!task.dueDate) continue;
      const dayMs = 24 * 60 * 60 * 1000;
      const daysUntil = Math.ceil((task.dueDate.getTime() - now.getTime()) / dayMs);
      const when =
        daysUntil > 0
          ? `due in ${daysUntil}d`
          : daysUntil === 0
            ? "due today"
            : `overdue by ${-daysUntil}d`;

      if (task.dueNotifiedFor?.getTime() === task.dueDate.getTime()) {
        detail.push(`· ${task.title}: ${when} — already reminded for this due date`);
        continue;
      }

      const recipient =
        task.assignee && task.assignee.isActive
          ? task.assignee
          : task.createdBy.isActive
            ? task.createdBy
            : null;
      if (!recipient) {
        detail.push(`· ${task.title}: ${when} — SKIPPED, no active assignee or creator`);
        continue;
      }
      const who = task.assignee && task.assignee.isActive ? "assignee" : "creator (unassigned)";

      if (ctx.dryRun) {
        detail.push(`→ ${task.title}: ${when} — WOULD remind ${recipient.name} (${who})`);
        notified++;
        continue;
      }

      try {
        await notify({
          recipientId: recipient.id,
          type: "task-due-soon",
          title:
            daysUntil >= 0
              ? `Task ${when}: ${task.title}`
              : `Task overdue: ${task.title}`,
          body: `${task.title} — ${when}`,
          href: `/tasks#task-${task.id}`,
          entityType: "task",
          entityId: task.id,
          email: {
            templateKey: "notification",
            data: {
              recipientName: recipient.name,
              heading: `Task ${when}: ${task.title}`,
              body: `"${task.title}" is ${when}. Open it to update the status or adjust the due date.`,
              cta: {
                label: "Open task",
                url: absoluteUrl(`/tasks#task-${task.id}`),
              },
            },
          },
        });
        notified++;
        await db.task.update({
          where: { id: task.id },
          data: { dueNotifiedFor: task.dueDate },
        });
        detail.push(`→ ${task.title}: ${when} — reminded ${recipient.name} (${who})`);
      } catch (err) {
        log.error("jobs.taskDue", "Notify failed", err, { taskId: task.id });
        detail.push(`· ${task.title}: ${when} — FAILED to notify (see logs)`);
      }
    }

    const summary = [
      `Checked ${candidates.length} open task${candidates.length === 1 ? "" : "s"} due within ${leadDays}d (or overdue), ${ctx.dryRun ? "would send" : "sent"} ${notified} reminder${notified === 1 ? "" : "s"}.`,
      ...(detail.length > 0 ? ["", ...detail] : []),
    ].join("\n");

    return { output: summary, processed: notified };
  },
};
