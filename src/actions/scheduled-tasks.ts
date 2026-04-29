"use server";

import { db } from "@/lib/db";
import { requireAuth } from "@/lib/permissions";
import { logActivity } from "@/lib/activity";
import { runOne } from "@/lib/scheduled-tasks/runner";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import type {
  ScheduledTaskFrequency,
  ScheduledTaskType,
  Role,
} from "@prisma/client";

// Scheduled tasks are admin-only — they email outside the org and run
// arbitrary registered reports. Gate every action on Role=ADMIN.
function requireAdmin(role: Role): { error: string } | null {
  if (role !== "ADMIN") {
    return { error: "Admin access required" };
  }
  return null;
}

const taskTypeSchema = z.enum(["EMAIL_REPORT", "EMAIL_MESSAGE"]);
const frequencySchema = z.enum(["HOURLY", "DAILY", "WEEKLY", "MONTHLY"]);

const upsertSchema = z.object({
  name: z.string().min(1, "Name is required"),
  description: z.string().nullish(),
  taskType: taskTypeSchema,
  frequency: frequencySchema,
  hourUtc: z.number().int().min(0).max(23),
  dayOfWeek: z.number().int().min(0).max(6).nullish(),
  dayOfMonth: z.number().int().min(1).max(28).nullish(),
  config: z.record(z.unknown()),
  isActive: z.boolean().optional(),
});

export type ScheduledTaskUpsertInput = z.infer<typeof upsertSchema>;

export async function createScheduledTask(input: ScheduledTaskUpsertInput) {
  const user = await requireAuth();
  const gate = requireAdmin(user.role);
  if (gate) return gate;

  const parsed = upsertSchema.safeParse(input);
  if (!parsed.success) {
    return {
      error: "Invalid input",
      fieldErrors: parsed.error.flatten().fieldErrors,
    } as const;
  }

  const created = await db.scheduledTask.create({
    data: {
      name: parsed.data.name,
      description: parsed.data.description?.trim() || null,
      taskType: parsed.data.taskType as ScheduledTaskType,
      frequency: parsed.data.frequency as ScheduledTaskFrequency,
      hourUtc: parsed.data.hourUtc,
      dayOfWeek: parsed.data.dayOfWeek ?? null,
      dayOfMonth: parsed.data.dayOfMonth ?? null,
      config: JSON.stringify(parsed.data.config),
      isActive: parsed.data.isActive ?? true,
      createdById: user.id,
    },
  });

  await logActivity("created", "scheduled-task", created.id, user.id, created.name);
  revalidatePath("/admin/scheduled-tasks");
  return { success: true, id: created.id } as const;
}

export async function updateScheduledTask(
  input: { id: string } & ScheduledTaskUpsertInput
) {
  const user = await requireAuth();
  const gate = requireAdmin(user.role);
  if (gate) return gate;

  const parsed = upsertSchema.safeParse(input);
  if (!parsed.success) {
    return {
      error: "Invalid input",
      fieldErrors: parsed.error.flatten().fieldErrors,
    } as const;
  }

  await db.scheduledTask.update({
    where: { id: input.id },
    data: {
      name: parsed.data.name,
      description: parsed.data.description?.trim() || null,
      taskType: parsed.data.taskType as ScheduledTaskType,
      frequency: parsed.data.frequency as ScheduledTaskFrequency,
      hourUtc: parsed.data.hourUtc,
      dayOfWeek: parsed.data.dayOfWeek ?? null,
      dayOfMonth: parsed.data.dayOfMonth ?? null,
      config: JSON.stringify(parsed.data.config),
      isActive: parsed.data.isActive ?? true,
    },
  });

  await logActivity("updated", "scheduled-task", input.id, user.id, parsed.data.name);
  revalidatePath("/admin/scheduled-tasks");
  return { success: true } as const;
}

export async function deleteScheduledTask(id: string) {
  const user = await requireAuth();
  const gate = requireAdmin(user.role);
  if (gate) return gate;

  const existing = await db.scheduledTask.findUnique({
    where: { id },
    select: { name: true },
  });
  if (!existing) return { error: "Task not found" } as const;

  await db.scheduledTask.delete({ where: { id } });
  await logActivity("deleted", "scheduled-task", id, user.id, existing.name);
  revalidatePath("/admin/scheduled-tasks");
  return { success: true } as const;
}

/** Manual trigger from the admin "Run now" button. Runs synchronously
 *  so the admin sees the result inline. Errors are persisted onto the
 *  task row and surfaced in the action response. */
export async function runScheduledTaskNow(id: string) {
  const user = await requireAuth();
  const gate = requireAdmin(user.role);
  if (gate) return gate;

  const result = await runOne(id);
  await logActivity("ran", "scheduled-task", id, user.id, result.success ? "success" : "failed");
  revalidatePath("/admin/scheduled-tasks");
  if (!result.success) {
    return { error: result.error ?? "Run failed" } as const;
  }
  return { success: true } as const;
}

export async function toggleScheduledTaskActive(id: string, isActive: boolean) {
  const user = await requireAuth();
  const gate = requireAdmin(user.role);
  if (gate) return gate;

  await db.scheduledTask.update({
    where: { id },
    data: { isActive },
  });
  revalidatePath("/admin/scheduled-tasks");
  return { success: true } as const;
}
