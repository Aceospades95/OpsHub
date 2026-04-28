/**
 * Workflow execution engine.
 *
 * This is the runtime that turns a WorkflowTemplate into an in-flight
 * WorkflowInstance with scheduled steps that fire at the right times.
 *
 * Entry points:
 *
 *   createInstance()  — materialize an instance + all its steps, computed
 *                       to scheduledFor based on the template's timing
 *                       rules. Status starts at PENDING.
 *
 *   startInstance()   — flip PENDING → IN_PROGRESS and immediately tick
 *                       any steps whose scheduledFor is now-or-past.
 *
 *   tick(instanceId?) — process due steps for one instance (or all
 *                       active instances when instanceId is omitted).
 *                       Idempotent — safe to call from cron and from
 *                       manual admin "Run now" buttons.
 *
 *   completeStep()    — marks a step COMPLETED and recomputes downstream
 *                       AFTER_STEP scheduledFor values. Called by handlers
 *                       on success and by portal/manual completions.
 *
 *   failStep()        — marks a step FAILED with an error string. The
 *                       instance keeps running unless the step was
 *                       isRequired, in which case the instance pauses.
 *
 * Design notes:
 *
 * Concurrency: the tick loop uses optimistic concurrency by transitioning
 * step status PENDING/SCHEDULED → IN_PROGRESS in a transaction; if two
 * workers race, the second one sees IN_PROGRESS and skips.
 *
 * Failure: handlers are wrapped in try/catch. A handler throwing puts
 * the step into FAILED status with the message; the instance keeps
 * processing other steps so a flaky email step doesn't stall onboarding.
 */

import { db } from "@/lib/db";
import { resolveScheduledFor } from "./timing";
import { randomBytes } from "crypto";
import { buildInstanceContext, type WorkflowContext } from "./context";
import { runStepHandler } from "./handlers";

/**
 * 32-byte CSPRNG token used for portal links. URL-safe (base64url) so
 * it survives copy-paste, link shorteners, and email-quoting. Lives
 * here rather than in a shared util because it's only used once — at
 * instance create — and inlining keeps the dependency graph tight.
 */
function generatePortalToken(): string {
  return randomBytes(32).toString("base64url");
}
import type {
  WorkflowInstance,
  WorkflowInstanceStep,
  WorkflowStep,
  WorkflowSubjectType,
} from "@prisma/client";

// ─── Lifecycle types ──────────────────────────────────────────────────

export interface CreateInstanceInput {
  templateId: string;
  subjectType: WorkflowSubjectType;
  subjectId: string;
  startDate?: Date;
  targetDate?: Date | null;
  createdById: string;
  /** Auto-start after creation. Defaults to true so the manual flow
   *  doesn't need a second click. Set false when seeding instances
   *  ahead of time (e.g. scheduled triggers). */
  autoStart?: boolean;
}

export interface CreateInstanceResult {
  instanceId: string;
  scheduledStepIds: string[];
}

// ─── Public API ───────────────────────────────────────────────────────

export async function createInstance(
  input: CreateInstanceInput
): Promise<CreateInstanceResult> {
  const template = await db.workflowTemplate.findUnique({
    where: { id: input.templateId },
    include: { steps: { orderBy: { position: "asc" } } },
  });
  if (!template) {
    throw new Error(`Workflow template ${input.templateId} not found`);
  }
  if (!template.isActive) {
    throw new Error(`Workflow template ${template.name} is archived`);
  }

  const startDate = input.startDate ?? new Date();
  const targetDate = input.targetDate ?? null;

  // Look up an existing portal token for this subject so the same link
  // works across instances. Phase 5's portal owns token rotation.
  const existingToken = await db.portalToken.findUnique({
    where: {
      subjectType_subjectId: {
        subjectType: input.subjectType,
        subjectId: input.subjectId,
      },
    },
    select: { token: true },
  });
  let portalToken = existingToken?.token ?? null;
  if (!portalToken) {
    const tokenValue = generatePortalToken();
    await db.portalToken.create({
      data: {
        subjectType: input.subjectType,
        subjectId: input.subjectId,
        token: tokenValue,
      },
    });
    portalToken = tokenValue;
  }

  const instance = await db.workflowInstance.create({
    data: {
      workflowTemplateId: template.id,
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      status: "PENDING",
      startDate,
      targetDate,
      createdById: input.createdById,
      // Context is filled in below once we have an id for the portal URL.
      context: null,
    },
  });

  const context = await buildInstanceContext({
    instanceId: instance.id,
    workflowName: template.name,
    startDate,
    targetDate,
    subjectType: input.subjectType,
    subjectId: input.subjectId,
    portalToken,
  });

  await db.workflowInstance.update({
    where: { id: instance.id },
    data: { context: JSON.stringify(context) },
  });

  // Materialize one WorkflowInstanceStep per template step. Steps with
  // resolvable scheduledFor get status SCHEDULED; ones that depend on
  // missing data (e.g. AFTER_STEP without a predecessor yet) stay
  // PENDING until completeStep() recomputes them.
  const scheduledStepIds: string[] = [];
  for (const step of template.steps) {
    const scheduledFor = resolveScheduledFor({
      timingType: step.timingType,
      timingValue: step.timingValue,
      instanceStartDate: startDate,
      instanceTargetDate: targetDate,
      // No predecessor data on initial seed — AFTER_STEP entries stay PENDING.
      predecessorCompletedAt: null,
    });
    const created = await db.workflowInstanceStep.create({
      data: {
        workflowInstanceId: instance.id,
        workflowStepId: step.id,
        status: scheduledFor ? "SCHEDULED" : "PENDING",
        scheduledFor: scheduledFor ?? null,
      },
    });
    if (scheduledFor) scheduledStepIds.push(created.id);
  }

  await db.workflowEvent.create({
    data: {
      workflowInstanceId: instance.id,
      eventType: "instance_created",
      actorType: "user",
      actorId: input.createdById,
    },
  });

  if (input.autoStart !== false) {
    await startInstance(instance.id);
  }

  return { instanceId: instance.id, scheduledStepIds };
}

export async function startInstance(instanceId: string): Promise<void> {
  const instance = await db.workflowInstance.findUnique({
    where: { id: instanceId },
    select: { id: true, status: true },
  });
  if (!instance) throw new Error(`Instance ${instanceId} not found`);
  if (instance.status === "IN_PROGRESS" || instance.status === "COMPLETED") {
    return;
  }

  await db.workflowInstance.update({
    where: { id: instanceId },
    data: { status: "IN_PROGRESS", startedAt: new Date() },
  });
  await db.workflowEvent.create({
    data: {
      workflowInstanceId: instanceId,
      eventType: "instance_started",
      actorType: "system",
    },
  });

  await tick(instanceId);
}

/**
 * Process due steps for an instance (or all active instances).
 *
 * Returns the number of steps the tick fired. Callers — the cron job
 * and the admin "Run now" button — both rely on the count for log output.
 */
export async function tick(instanceId?: string): Promise<{
  fired: number;
  failed: number;
  completed: number;
}> {
  const now = new Date();

  // Fetch SCHEDULED steps whose time has come, scoped to one instance
  // when an id was supplied. Joining the parent instance lets us skip
  // paused/cancelled instances without a second query.
  const due = await db.workflowInstanceStep.findMany({
    where: {
      status: "SCHEDULED",
      scheduledFor: { lte: now },
      workflowInstance: instanceId
        ? { id: instanceId, status: "IN_PROGRESS" }
        : { status: "IN_PROGRESS" },
    },
    include: {
      workflowStep: true,
      workflowInstance: true,
    },
    take: 200, // soft cap so a runaway tick doesn't block the worker
  });

  let fired = 0;
  let failed = 0;
  let completed = 0;
  const touchedInstanceIds = new Set<string>();

  for (const step of due) {
    touchedInstanceIds.add(step.workflowInstanceId);
    // Optimistic concurrency: only proceed if we win the SCHEDULED→IN_PROGRESS
    // transition. updateMany returns count; 0 means another worker took it.
    const claim = await db.workflowInstanceStep.updateMany({
      where: { id: step.id, status: "SCHEDULED" },
      data: { status: "IN_PROGRESS", startedAt: new Date() },
    });
    if (claim.count === 0) continue;

    fired++;
    try {
      const ctx = parseContext(step.workflowInstance.context);
      const config = parseConfig(step.workflowStep.config);
      const outcome = await runStepHandler({
        stepType: step.workflowStep.stepType,
        config,
        context: ctx,
        instanceId: step.workflowInstanceId,
        instanceStepId: step.id,
        subjectType: step.workflowInstance.subjectType,
        subjectId: step.workflowInstance.subjectId,
      });

      if (outcome.kind === "completed") {
        await completeStep(step.id, outcome.output ?? null);
        completed++;
      } else if (outcome.kind === "skipped") {
        await skipStep(step.id, outcome.reason);
      } else {
        // "waiting" — the handler did its work but the step won't be
        // marked completed until something external finishes it
        // (approval, document upload, signature). Status stays
        // IN_PROGRESS until that happens.
        if (outcome.output != null) {
          await db.workflowInstanceStep.update({
            where: { id: step.id },
            data: { output: JSON.stringify(outcome.output) },
          });
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await failStep(step.id, message);
      failed++;
    }
  }

  // After processing each batch, check whether any instance has finished
  // (all required steps in a terminal state) and seal it.
  for (const id of Array.from(touchedInstanceIds)) {
    await maybeCompleteInstance(id);
  }

  return { fired, failed, completed };
}

export async function completeStep(
  instanceStepId: string,
  output: unknown
): Promise<void> {
  const now = new Date();
  const step = await db.workflowInstanceStep.findUnique({
    where: { id: instanceStepId },
    include: { workflowInstance: true, workflowStep: true },
  });
  if (!step) return;
  if (step.status === "COMPLETED" || step.status === "SKIPPED") return;

  await db.workflowInstanceStep.update({
    where: { id: instanceStepId },
    data: {
      status: "COMPLETED",
      completedAt: now,
      output: output != null ? JSON.stringify(output) : step.output,
    },
  });
  await db.workflowEvent.create({
    data: {
      workflowInstanceId: step.workflowInstanceId,
      eventType: "step_completed",
      actorType: "system",
      metadata: JSON.stringify({
        stepName: step.workflowStep.name,
        stepType: step.workflowStep.stepType,
      }),
    },
  });

  // Recompute downstream AFTER_STEP entries that depended on this step.
  await scheduleDownstream(instanceStepId, step.workflowInstance, now);

  // Then sweep — the completion may itself unblock further AFTER_STEPs
  // and may finish the instance.
  await maybeCompleteInstance(step.workflowInstanceId);
}

export async function skipStep(
  instanceStepId: string,
  reason?: string
): Promise<void> {
  const step = await db.workflowInstanceStep.findUnique({
    where: { id: instanceStepId },
    include: { workflowInstance: true, workflowStep: true },
  });
  if (!step) return;
  if (step.status === "COMPLETED" || step.status === "SKIPPED") return;

  await db.workflowInstanceStep.update({
    where: { id: instanceStepId },
    data: {
      status: "SKIPPED",
      completedAt: new Date(),
      output: reason ? JSON.stringify({ reason }) : step.output,
    },
  });
  await db.workflowEvent.create({
    data: {
      workflowInstanceId: step.workflowInstanceId,
      eventType: "step_skipped",
      actorType: "system",
      metadata: JSON.stringify({
        stepName: step.workflowStep.name,
        reason: reason ?? null,
      }),
    },
  });

  // SKIPPED counts as terminal for downstream AFTER_STEP scheduling —
  // dependents shouldn't wait forever for a step that won't run.
  await scheduleDownstream(instanceStepId, step.workflowInstance, new Date());
  await maybeCompleteInstance(step.workflowInstanceId);
}

export async function failStep(
  instanceStepId: string,
  error: string
): Promise<void> {
  const step = await db.workflowInstanceStep.findUnique({
    where: { id: instanceStepId },
    include: { workflowStep: true, workflowInstance: true },
  });
  if (!step) return;

  await db.workflowInstanceStep.update({
    where: { id: instanceStepId },
    data: {
      status: "FAILED",
      error,
      completedAt: new Date(),
    },
  });
  await db.workflowEvent.create({
    data: {
      workflowInstanceId: step.workflowInstanceId,
      eventType: "step_failed",
      actorType: "system",
      metadata: JSON.stringify({
        stepName: step.workflowStep.name,
        error,
      }),
    },
  });

  // Required step failure pauses the instance so an admin can intervene.
  if (step.workflowStep.isRequired) {
    await db.workflowInstance.update({
      where: { id: step.workflowInstanceId },
      data: { status: "PAUSED" },
    });
    await db.workflowEvent.create({
      data: {
        workflowInstanceId: step.workflowInstanceId,
        eventType: "instance_paused",
        actorType: "system",
        metadata: JSON.stringify({ reason: "required_step_failed" }),
      },
    });
  }
}

export async function pauseInstance(instanceId: string): Promise<void> {
  await db.workflowInstance.updateMany({
    where: { id: instanceId, status: "IN_PROGRESS" },
    data: { status: "PAUSED" },
  });
  await db.workflowEvent.create({
    data: {
      workflowInstanceId: instanceId,
      eventType: "instance_paused",
      actorType: "user",
    },
  });
}

export async function resumeInstance(instanceId: string): Promise<void> {
  await db.workflowInstance.updateMany({
    where: { id: instanceId, status: "PAUSED" },
    data: { status: "IN_PROGRESS" },
  });
  await db.workflowEvent.create({
    data: {
      workflowInstanceId: instanceId,
      eventType: "instance_resumed",
      actorType: "user",
    },
  });
  await tick(instanceId);
}

export async function cancelInstance(instanceId: string): Promise<void> {
  await db.$transaction([
    db.workflowInstance.update({
      where: { id: instanceId },
      data: { status: "CANCELLED", completedAt: new Date() },
    }),
    // Anything still pending/scheduled becomes SKIPPED so the timeline
    // displays a clean terminal state for every step.
    db.workflowInstanceStep.updateMany({
      where: {
        workflowInstanceId: instanceId,
        status: { in: ["PENDING", "SCHEDULED", "IN_PROGRESS"] },
      },
      data: { status: "SKIPPED", completedAt: new Date() },
    }),
  ]);
  await db.workflowEvent.create({
    data: {
      workflowInstanceId: instanceId,
      eventType: "instance_cancelled",
      actorType: "user",
    },
  });
}

// ─── Internal helpers ─────────────────────────────────────────────────

/**
 * Recompute scheduledFor for any AFTER_STEP children that depend on
 * the step that just completed/skipped. Sets status SCHEDULED so the
 * next tick picks them up.
 */
async function scheduleDownstream(
  predecessorInstanceStepId: string,
  instance: WorkflowInstance,
  completedAt: Date
) {
  const predecessor = await db.workflowInstanceStep.findUnique({
    where: { id: predecessorInstanceStepId },
    include: { workflowStep: true },
  });
  if (!predecessor) return;

  const dependents = await db.workflowInstanceStep.findMany({
    where: {
      workflowInstanceId: instance.id,
      status: "PENDING",
      workflowStep: {
        timingType: "AFTER_STEP",
        afterStepId: predecessor.workflowStepId,
      },
    },
    include: { workflowStep: true },
  });

  for (const dep of dependents) {
    const at = resolveScheduledFor({
      timingType: dep.workflowStep.timingType,
      timingValue: dep.workflowStep.timingValue,
      instanceStartDate: instance.startDate,
      instanceTargetDate: instance.targetDate,
      predecessorCompletedAt: completedAt,
    });
    if (!at) continue;
    await db.workflowInstanceStep.update({
      where: { id: dep.id },
      data: { status: "SCHEDULED", scheduledFor: at },
    });
  }
}

async function maybeCompleteInstance(instanceId: string): Promise<void> {
  const instance = await db.workflowInstance.findUnique({
    where: { id: instanceId },
    select: { id: true, status: true },
  });
  if (!instance) return;
  if (
    instance.status === "COMPLETED" ||
    instance.status === "CANCELLED" ||
    instance.status === "PAUSED"
  ) {
    return;
  }

  // Instance is done when every required step is in a terminal state
  // (COMPLETED, SKIPPED, or — fine — FAILED-but-paused). Optional steps
  // can drag past completion; they don't block.
  const remaining = await db.workflowInstanceStep.count({
    where: {
      workflowInstanceId: instanceId,
      workflowStep: { isRequired: true },
      status: { in: ["PENDING", "SCHEDULED", "IN_PROGRESS"] },
    },
  });
  if (remaining > 0) return;

  await db.workflowInstance.update({
    where: { id: instanceId },
    data: { status: "COMPLETED", completedAt: new Date() },
  });
  await db.workflowEvent.create({
    data: {
      workflowInstanceId: instanceId,
      eventType: "instance_completed",
      actorType: "system",
    },
  });
}

function parseConfig(raw: string): Record<string, unknown> {
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function parseContext(raw: string | null): WorkflowContext {
  if (!raw) {
    // Should never happen in practice — buildInstanceContext always
    // writes something — but bullet-proofing keeps tests simple.
    return EMPTY_CONTEXT;
  }
  try {
    return JSON.parse(raw) as WorkflowContext;
  } catch {
    return EMPTY_CONTEXT;
  }
}

const EMPTY_CONTEXT: WorkflowContext = {
  subject: {
    id: "",
    firstName: null,
    lastName: null,
    fullName: "(unknown)",
    email: null,
    jobTitle: null,
    department: null,
    startDate: null,
  },
  manager: {
    id: null,
    firstName: null,
    fullName: "(no manager)",
    email: null,
  },
  company: { name: "OpsHub" },
  workflow: {
    id: "",
    name: "",
    startDate: new Date(0),
    targetDate: null,
  },
  portal: { url: "" },
};

// Re-export for tests so they can build instance step rows without
// importing private types.
export type StepWithDef = WorkflowInstanceStep & {
  workflowStep: WorkflowStep;
};
