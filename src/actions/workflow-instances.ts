"use server";

import { db } from "@/lib/db";
import { log } from "@/lib/log";
import {
  requireAuth,
  resolveModulePerms,
  type PermissionFlags,
} from "@/lib/permissions";
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
import {
  ensurePortalToken,
  revokePortalTokenForSubject,
} from "@/lib/workflows/portal";
import { absoluteUrl } from "@/lib/url";
import { z } from "zod";
import type { WorkflowSubjectType } from "@prisma/client";

// ─── Validation ──────────────────────────────────────────────────────────

const subjectTypeSchema = z.enum(["EMPLOYEE", "CUSTOM"]);

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

/**
 * Lifecycle + approval actions are management operations, not general
 * edits: role defaults hand every CONTRIBUTOR canEdit on the workflows
 * module, but completing another employee's onboarding steps, approving
 * gates, or cancelling instances must stay with managers. An explicit
 * module-permission row granting canManage is the intended escape hatch
 * for delegating this to a specific user.
 */
function canDriveInstances(
  role: string,
  perms: PermissionFlags
): boolean {
  return perms.canManage || (role === "MANAGER" && perms.canEdit);
}

async function requireInstanceDriver(): Promise<
  | { error: string; user?: undefined }
  | { user: Awaited<ReturnType<typeof requireAuth>>; error?: undefined }
> {
  const user = await requireAuth();
  const perms = await resolveModulePerms(user.id, user.role, "workflows");
  if (!canDriveInstances(user.role, perms)) {
    return { error: "Permission denied" };
  }
  return { user };
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
  // CUSTOM can be free-form (engine resolves it at run time).
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
    // Engine-thrown errors with friendly messages ("template not found",
    // "template archived") flow through to the user. Anything that
    // isn't an Error subclass we treat as an unknown internal failure
    // and don't echo to the client.
    log.error("workflow-instances.create", "createInstance failed", err);
    if (err instanceof Error && /^Workflow template /.test(err.message)) {
      return { error: err.message } as const;
    }
    return {
      error: "Could not start workflow. Check server logs for details.",
    } as const;
  }
}

export async function startWorkflowInstance(instanceId: string) {
  const gate = await requireInstanceDriver();
  if (gate.error) return { error: gate.error } as const;
  await startInstance(instanceId);
  revalidateWorkflowInstance(instanceId);
  return { success: true } as const;
}

export async function pauseWorkflowInstance(instanceId: string) {
  const gate = await requireInstanceDriver();
  if (gate.error) return { error: gate.error } as const;
  await pauseInstance(instanceId);
  revalidateWorkflowInstance(instanceId);
  return { success: true } as const;
}

export async function resumeWorkflowInstance(instanceId: string) {
  const gate = await requireInstanceDriver();
  if (gate.error) return { error: gate.error } as const;
  await resumeInstance(instanceId);
  revalidateWorkflowInstance(instanceId);
  return { success: true } as const;
}

export async function cancelWorkflowInstance(instanceId: string) {
  const gate = await requireInstanceDriver();
  if (gate.error) return { error: gate.error } as const;
  await cancelInstance(instanceId);
  revalidateWorkflowInstance(instanceId);
  return { success: true } as const;
}

export async function completeWorkflowInstanceStep(
  instanceStepId: string,
  output?: unknown
) {
  const gate = await requireInstanceDriver();
  if (gate.error !== undefined) return { error: gate.error } as const;
  const user = gate.user;
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
  const gate = await requireInstanceDriver();
  if (gate.error) return { error: gate.error } as const;
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
  const gate = await requireInstanceDriver();
  if (gate.error) return { error: gate.error } as const;
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

  const step = await db.workflowInstanceStep.findUnique({
    where: { id: instanceStepId },
    include: { workflowStep: true },
  });
  if (!step) return { error: "Step not found" } as const;
  if (step.workflowStep.stepType !== "APPROVAL") {
    return { error: "Step is not an approval gate" } as const;
  }

  // The decision belongs to the approver the handler resolved on entry
  // (stored in the step output), or to someone with instance-driver
  // rights. Plain canEdit isn't enough — that would let any
  // CONTRIBUTOR approve gates configured for their manager.
  let configuredApproverId: string | null = null;
  if (step.output) {
    try {
      const out = JSON.parse(step.output) as { approverId?: string | null };
      configuredApproverId = out.approverId ?? null;
    } catch {
      // Malformed output — fall through to the driver check.
    }
  }
  const isConfiguredApprover =
    configuredApproverId !== null && configuredApproverId === user.id;
  if (!isConfiguredApprover && !canDriveInstances(user.role, perms)) {
    return { error: "Permission denied" } as const;
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
  const gate = await requireInstanceDriver();
  if (gate.error) return { error: gate.error } as const;
  const result = await tick(instanceId);
  revalidateWorkflowInstance(instanceId);
  return { success: true, ...result } as const;
}

// ─── Portal token management ─────────────────────────────────────────────
//
// The portal token is keyed by (subjectType, subjectId), not by
// instance — both actions take an instanceId because that's where the
// admin is standing, then operate on the subject's token. Revoking
// kills the link for EVERY instance the subject has; reissuing mints
// a replacement.

/**
 * Kill the subject's portal link immediately. A revoked token resolves
 * like an expired one, so a leaked link dies now instead of riding out
 * its 90-day expiry — and it stops granting access to later instances
 * too, because the engine skips revoked rows and mints fresh.
 *
 * No active token (none minted yet, or already revoked) is a no-op
 * success: the end state the caller asked for already holds.
 */
export async function revokePortalToken(instanceId: string) {
  const gate = await requireInstanceDriver();
  if (gate.error !== undefined) return { error: gate.error } as const;
  const instance = await db.workflowInstance.findUnique({
    where: { id: instanceId },
    select: { subjectType: true, subjectId: true },
  });
  if (!instance) return { error: "Instance not found" } as const;

  const revokedTokenId = await revokePortalTokenForSubject(
    instance.subjectType,
    instance.subjectId
  );
  if (revokedTokenId) {
    await logActivity("revoked", "portal-token", revokedTokenId, gate.user.id);
  }
  revalidateWorkflowInstance(instanceId, {
    subjectType: instance.subjectType,
    subjectId: instance.subjectId,
  });
  return { success: true } as const;
}

/**
 * Replace the subject's portal link: revoke whatever is active, then
 * mint a fresh token (same code path the engine uses at instance
 * create). Returns the new portal URL so the UI can surface it to the
 * admin straight away.
 */
export async function reissuePortalToken(instanceId: string) {
  const gate = await requireInstanceDriver();
  if (gate.error !== undefined) return { error: gate.error } as const;
  const instance = await db.workflowInstance.findUnique({
    where: { id: instanceId },
    select: { subjectType: true, subjectId: true },
  });
  if (!instance) return { error: "Instance not found" } as const;

  const revokedTokenId = await revokePortalTokenForSubject(
    instance.subjectType,
    instance.subjectId
  );
  if (revokedTokenId) {
    await logActivity("revoked", "portal-token", revokedTokenId, gate.user.id);
  }
  const token = await ensurePortalToken(
    instance.subjectType,
    instance.subjectId
  );
  const minted = await db.portalToken.findUnique({
    where: {
      subjectType_subjectId: {
        subjectType: instance.subjectType,
        subjectId: instance.subjectId,
      },
    },
    select: { id: true },
  });
  await logActivity(
    "reissued",
    "portal-token",
    minted?.id ?? instanceId,
    gate.user.id
  );

  // Built the same way the engine bakes it into instance contexts
  // (see buildInstanceContext in lib/workflows/context.ts).
  const portalUrl = absoluteUrl(`/portal/${token}`);

  // Contexts are intentionally frozen snapshots, but portal.url is the
  // one field that must track the live token — otherwise every future
  // {{portal.url}} render (reminder emails, scheduled sends) on the
  // subject's open instances would carry the dead link we just revoked.
  await refreshPortalUrlInContexts(
    instance.subjectType,
    instance.subjectId,
    portalUrl
  );

  revalidateWorkflowInstance(instanceId, {
    subjectType: instance.subjectType,
    subjectId: instance.subjectId,
  });
  return { success: true, portalUrl } as const;
}

async function refreshPortalUrlInContexts(
  subjectType: WorkflowSubjectType,
  subjectId: string,
  portalUrl: string
) {
  const instances = await db.workflowInstance.findMany({
    where: {
      subjectType,
      subjectId,
      status: { in: ["PENDING", "IN_PROGRESS", "PAUSED"] },
      context: { not: null },
    },
    select: { id: true, context: true },
  });
  for (const inst of instances) {
    try {
      const ctx = JSON.parse(inst.context ?? "{}") as {
        portal?: { url?: string };
      };
      ctx.portal = { ...(ctx.portal ?? {}), url: portalUrl };
      await db.workflowInstance.update({
        where: { id: inst.id },
        data: { context: JSON.stringify(ctx) },
      });
    } catch {
      // Malformed context — leave it alone; the engine has its own
      // fallback for unparseable blobs.
    }
  }
}
