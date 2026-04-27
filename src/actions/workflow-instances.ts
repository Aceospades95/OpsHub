"use server";

import { db } from "@/lib/db";
import { requireAuth, resolveModulePerms } from "@/lib/permissions";
import { logActivity } from "@/lib/activity";
import { revalidateWorkflowInstance } from "@/lib/revalidate-entity";
import {
  cancelInstance,
  completeStep,
  createInstance,
  failStep,
  pauseInstance,
  resumeInstance,
  skipStep,
  startInstance,
  tick,
} from "@/lib/workflows/engine";
import { z } from "zod";
import type { WorkflowSubjectType } from "@prisma/client";

// ─── Validation ──────────────────────────────────────────────────────────

const subjectTypeSchema = z.enum(["EMPLOYEE", "CANDIDATE", "CUSTOM"]);

const createInstanceSchema = z.object({
  templateId: z.string().min(1),
  subjectType: subjectTypeSchema,
  subjectId: z.string().min(1),
  startDate: z.string().nullish(),
  targetDate: z.string().nullish(),
  autoStart: z.boolean().optional(),
});

function parseDate(v: string | null | undefined): Date | null {
  if (!v) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

// ─── Lifecycle actions ──────────────────────────────────────────────────

export async function createWorkflowInstance(
  input: z.infer<typeof createInstanceSchema>
) {
  const user = await requireAuth();
  const perms = await resolveModulePerms(user.id, user.role, "workflows");
  if (!perms.canCreate) return { error: "Permission denied" } as const;

  const parsed = createInstanceSchema.safeParse(input);
  if (!parsed.success) {
    return {
      error: "Invalid input",
      fieldErrors: parsed.error.flatten().fieldErrors,
    } as const;
  }

  // Validate subject for EMPLOYEE — confirm the user actually exists.
  // CANDIDATE / CUSTOM can be free-form for now (Phase 5 fills in the
  // Candidate model + lookup).
  if (parsed.data.subjectType === "EMPLOYEE") {
    const subject = await db.user.findUnique({
      where: { id: parsed.data.subjectId },
      select: { id: true, isActive: true },
    });
    if (!subject) return { error: "Subject employee not found" } as const;
    if (!subject.isActive) {
      return { error: "Subject employee is inactive" } as const;
    }
  }

  try {
    const result = await createInstance({
      templateId: parsed.data.templateId,
      subjectType: parsed.data.subjectType as WorkflowSubjectType,
      subjectId: parsed.data.subjectId,
      startDate: parseDate(parsed.data.startDate) ?? new Date(),
      targetDate: parseDate(parsed.data.targetDate),
      createdById: user.id,
      autoStart: parsed.data.autoStart ?? true,
    });
    await logActivity(
      "started",
      "workflow-instance",
      result.instanceId,
      user.id
    );
    revalidateWorkflowInstance(result.instanceId, {
      subjectType: parsed.data.subjectType,
      subjectId: parsed.data.subjectId,
    });
    return { success: true, instanceId: result.instanceId } as const;
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "Could not start workflow",
    } as const;
  }
}

export async function startWorkflowInstance(instanceId: string) {
  const user = await requireAuth();
  const perms = await resolveModulePerms(user.id, user.role, "workflows");
  if (!perms.canEdit) return { error: "Permission denied" } as const;
  await startInstance(instanceId);
  revalidateWorkflowInstance(instanceId);
  return { success: true } as const;
}

export async function pauseWorkflowInstance(instanceId: string) {
  const user = await requireAuth();
  const perms = await resolveModulePerms(user.id, user.role, "workflows");
  if (!perms.canEdit) return { error: "Permission denied" } as const;
  await pauseInstance(instanceId);
  revalidateWorkflowInstance(instanceId);
  return { success: true } as const;
}

export async function resumeWorkflowInstance(instanceId: string) {
  const user = await requireAuth();
  const perms = await resolveModulePerms(user.id, user.role, "workflows");
  if (!perms.canEdit) return { error: "Permission denied" } as const;
  await resumeInstance(instanceId);
  revalidateWorkflowInstance(instanceId);
  return { success: true } as const;
}

export async function cancelWorkflowInstance(instanceId: string) {
  const user = await requireAuth();
  const perms = await resolveModulePerms(user.id, user.role, "workflows");
  if (!perms.canEdit) return { error: "Permission denied" } as const;
  await cancelInstance(instanceId);
  revalidateWorkflowInstance(instanceId);
  return { success: true } as const;
}

export async function completeWorkflowInstanceStep(
  instanceStepId: string,
  output?: unknown
) {
  const user = await requireAuth();
  const perms = await resolveModulePerms(user.id, user.role, "workflows");
  if (!perms.canEdit) return { error: "Permission denied" } as const;
  const step = await db.workflowInstanceStep.findUnique({
    where: { id: instanceStepId },
    select: { workflowInstanceId: true },
  });
  if (!step) return { error: "Step not found" } as const;
  await completeStep(instanceStepId, output ?? { completedBy: user.id });
  revalidateWorkflowInstance(step.workflowInstanceId);
  return { success: true } as const;
}

export async function skipWorkflowInstanceStep(
  instanceStepId: string,
  reason?: string
) {
  const user = await requireAuth();
  const perms = await resolveModulePerms(user.id, user.role, "workflows");
  if (!perms.canEdit) return { error: "Permission denied" } as const;
  const step = await db.workflowInstanceStep.findUnique({
    where: { id: instanceStepId },
    select: { workflowInstanceId: true },
  });
  if (!step) return { error: "Step not found" } as const;
  await skipStep(instanceStepId, reason);
  revalidateWorkflowInstance(step.workflowInstanceId);
  return { success: true } as const;
}

export async function failWorkflowInstanceStep(
  instanceStepId: string,
  error: string
) {
  const user = await requireAuth();
  const perms = await resolveModulePerms(user.id, user.role, "workflows");
  if (!perms.canEdit) return { error: "Permission denied" } as const;
  const step = await db.workflowInstanceStep.findUnique({
    where: { id: instanceStepId },
    select: { workflowInstanceId: true },
  });
  if (!step) return { error: "Step not found" } as const;
  await failStep(instanceStepId, error);
  revalidateWorkflowInstance(step.workflowInstanceId);
  return { success: true } as const;
}

/**
 * Approval action — used by the approver from the instance detail UI.
 * approve=true completes the step; approve=false rejects it (we model
 * a rejection as "skipped with reason" rather than "failed", since a
 * reject is an intentional admin decision, not an error).
 */
export async function decideApprovalStep(
  instanceStepId: string,
  approve: boolean,
  notes?: string
) {
  const user = await requireAuth();
  const perms = await resolveModulePerms(user.id, user.role, "workflows");
  if (!perms.canEdit) return { error: "Permission denied" } as const;

  const step = await db.workflowInstanceStep.findUnique({
    where: { id: instanceStepId },
    include: { workflowStep: true },
  });
  if (!step) return { error: "Step not found" } as const;
  if (step.workflowStep.stepType !== "APPROVAL") {
    return { error: "Step is not an approval gate" } as const;
  }

  if (approve) {
    await completeStep(instanceStepId, {
      decision: "approved",
      approverId: user.id,
      notes: notes ?? null,
    });
  } else {
    await skipStep(instanceStepId, notes ?? "rejected by approver");
  }
  revalidateWorkflowInstance(step.workflowInstanceId);
  return { success: true } as const;
}

/** Manual force-tick from admin UI. Useful for nudging stuck instances. */
export async function tickWorkflowInstance(instanceId: string) {
  const user = await requireAuth();
  const perms = await resolveModulePerms(user.id, user.role, "workflows");
  if (!perms.canEdit) return { error: "Permission denied" } as const;
  const result = await tick(instanceId);
  revalidateWorkflowInstance(instanceId);
  return { success: true, ...result } as const;
}
