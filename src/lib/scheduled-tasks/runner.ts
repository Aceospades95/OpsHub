/**
 * Runner — finds due ScheduledTask rows, dispatches each to its
 * handler, and persists the result back onto the row. Idempotent
 * via lastRunAt: a task that's already fired in the current window
 * is skipped.
 *
 * Two entry points:
 *
 *   tickAll()        — loops every active task. Called by the
 *                      `custom-scheduled-tasks` cron job (hourly).
 *
 *   runOne(taskId)   — runs a single task immediately, regardless of
 *                      schedule. Called by the admin "Run now" button.
 */

import { db } from "@/lib/db";
import { runHandler } from "./handlers";
import { isDueNow } from "./scheduling";

export interface TickResult {
  considered: number;
  fired: number;
  failed: number;
  skipped: number;
}

export async function tickAll(now: Date = new Date()): Promise<TickResult> {
  const tasks = await db.scheduledTask.findMany({
    where: { isActive: true },
    orderBy: { createdAt: "asc" },
  });

  let fired = 0;
  let failed = 0;
  let skipped = 0;
  for (const task of tasks) {
    if (
      !isDueNow({
        frequency: task.frequency,
        hourUtc: task.hourUtc,
        dayOfWeek: task.dayOfWeek,
        dayOfMonth: task.dayOfMonth,
        lastRunAt: task.lastRunAt,
        now,
      })
    ) {
      skipped++;
      continue;
    }
    const ok = await fireOne(task.id, now);
    if (ok) fired++;
    else failed++;
  }

  return { considered: tasks.length, fired, failed, skipped };
}

export async function runOne(taskId: string): Promise<{ success: boolean; error?: string }> {
  const ok = await fireOne(taskId, new Date());
  if (ok) return { success: true };
  // Pull the persisted error so the admin UI gets a useful message.
  const refreshed = await db.scheduledTask.findUnique({
    where: { id: taskId },
    select: { lastRunError: true },
  });
  return { success: false, error: refreshed?.lastRunError ?? "Run failed" };
}

async function fireOne(taskId: string, now: Date): Promise<boolean> {
  // Re-read the row with a fresh transaction so we capture the
  // current config — admins might have edited between schedule
  // resolution and dispatch.
  const task = await db.scheduledTask.findUnique({ where: { id: taskId } });
  if (!task) return false;

  let parsedConfig: Record<string, unknown> = {};
  try {
    parsedConfig = JSON.parse(task.config) as Record<string, unknown>;
  } catch {
    parsedConfig = {};
  }

  try {
    const result = await runHandler(task.taskType, {
      taskId: task.id,
      taskName: task.name,
      config: parsedConfig,
    });
    await db.scheduledTask.update({
      where: { id: task.id },
      data: {
        lastRunAt: now,
        lastRunStatus: "success",
        lastRunOutput: result.output,
        lastRunError: result.warning ?? null,
      },
    });
    return true;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db.scheduledTask.update({
      where: { id: task.id },
      data: {
        lastRunAt: now,
        lastRunStatus: "failed",
        lastRunError: message,
      },
    });
    return false;
  }
}
