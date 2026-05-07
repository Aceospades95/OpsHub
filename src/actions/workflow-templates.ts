"use server";

import { db } from "@/lib/db";
import { requireAuth, resolveModulePerms } from "@/lib/permissions";
import { logActivity } from "@/lib/activity";
import {
  revalidateWorkflowTemplate,
} from "@/lib/revalidate-entity";
import {
  STEP_TYPE_DEFINITIONS,
  validateStepConfig,
  validateStepConfigStrict,
} from "@/lib/workflows/step-types";
import { wouldCreateAfterStepCycle } from "@/lib/workflows/cycle-check";
import { z } from "zod";
import type { WorkflowStepType, WorkflowTimingType, WorkflowType, WorkflowSubjectType } from "@prisma/client";

const workflowTypeSchema = z.enum(["ONBOARDING", "OFFBOARDING", "CUSTOM"]);

const subjectTypeSchema = z.enum(["EMPLOYEE", "CUSTOM"]);

const templateMetaSchema = z.object({
  name: z.string().min(1, "Name is required"),
  description: z.string().nullish(),
  type: workflowTypeSchema.default("CUSTOM"),
  subjectEntityType: subjectTypeSchema.default("EMPLOYEE"),
  isActive: z.boolean().optional(),
});

function normalizeOptional(v: string | null | undefined): string | null {
  if (v == null) return null;
  const t = String(v).trim();
  return t.length === 0 ? null : t;
}

// ─── Templates CRUD ─────────────────────────────────────────────────────

export async function createWorkflowTemplate(input: z.infer<typeof templateMetaSchema>) {
  const user = await requireAuth();
  const perms = await resolveModulePerms(user.id, user.role, "workflows");
  if (!perms.canCreate) return { error: "Permission denied" } as const;

  const parsed = templateMetaSchema.safeParse(input);
  if (!parsed.success) {
    return {
      error: "Invalid input",
      fieldErrors: parsed.error.flatten().fieldErrors,
    } as const;
  }

  const tpl = await db.workflowTemplate.create({
    data: {
      name: parsed.data.name,
      description: normalizeOptional(parsed.data.description ?? null),
      type: parsed.data.type as WorkflowType,
      subjectEntityType: parsed.data.subjectEntityType as WorkflowSubjectType,
      isActive: parsed.data.isActive ?? true,
      createdById: user.id,
    },
  });

  await logActivity("created", "workflow-template", tpl.id, user.id, tpl.name);
  revalidateWorkflowTemplate(tpl.id);
  return { success: true, id: tpl.id } as const;
}

export async function updateWorkflowTemplateMeta(
  input: { id: string } & z.infer<typeof templateMetaSchema>
) {
  const user = await requireAuth();
  const perms = await resolveModulePerms(user.id, user.role, "workflows");
  if (!perms.canEdit) return { error: "Permission denied" } as const;

  const parsed = templateMetaSchema.safeParse(input);
  if (!parsed.success) {
    return {
      error: "Invalid input",
      fieldErrors: parsed.error.flatten().fieldErrors,
    } as const;
  }

  const tpl = await db.workflowTemplate.update({
    where: { id: input.id },
    data: {
      name: parsed.data.name,
      description: normalizeOptional(parsed.data.description ?? null),
      type: parsed.data.type as WorkflowType,
      subjectEntityType: parsed.data.subjectEntityType as WorkflowSubjectType,
      isActive: parsed.data.isActive ?? true,
    },
  });

  await logActivity("updated", "workflow-template", tpl.id, user.id, tpl.name);
  revalidateWorkflowTemplate(tpl.id);
  return { success: true } as const;
}

export async function deleteWorkflowTemplate(id: string) {
  const user = await requireAuth();
  const perms = await resolveModulePerms(user.id, user.role, "workflows");
  if (!perms.canDelete) return { error: "Permission denied" } as const;

  const tpl = await db.workflowTemplate.findUnique({
    where: { id },
    select: { id: true, name: true, isSeed: true },
  });
  if (!tpl) return { error: "Template not found" } as const;
  if (tpl.isSeed) {
    // Seeded templates can be archived (isActive=false) but not deleted —
    // they're system defaults the spec ships with, so we treat them as
    // immutable in identity if not in content.
    return {
      error: "System templates can't be deleted. Archive them instead.",
    } as const;
  }

  // Refuse hard delete when any instance still references the template.
  // A delete would cascade through the FK relation onto WorkflowInstance
  // rows, taking the audit history with them. Archive (isActive=false)
  // is the safe path — it stops new instances from spawning while
  // preserving the timeline of past runs.
  const instanceCount = await db.workflowInstance.count({
    where: { workflowTemplateId: id },
  });
  if (instanceCount > 0) {
    return {
      error: `This template has ${instanceCount} workflow instance${
        instanceCount === 1 ? "" : "s"
      } attached. Archive it instead — deleting would erase that history.`,
    } as const;
  }

  await db.workflowTemplate.delete({ where: { id } });
  await logActivity("deleted", "workflow-template", id, user.id, tpl.name);
  revalidateWorkflowTemplate(id);
  return { success: true } as const;
}

/**
 * Toggle a template between active and archived. Archived templates
 * stop firing on triggers and stop appearing in pickers, but their
 * existing instance history is preserved. Use this instead of delete
 * for any template that has run before — delete refuses when
 * instances exist precisely so this path is the obvious one.
 */
export async function setWorkflowTemplateActive(
  id: string,
  isActive: boolean
) {
  const user = await requireAuth();
  const perms = await resolveModulePerms(user.id, user.role, "workflows");
  if (!perms.canEdit) return { error: "Permission denied" } as const;

  const tpl = await db.workflowTemplate.findUnique({
    where: { id },
    select: { id: true, name: true, isActive: true },
  });
  if (!tpl) return { error: "Template not found" } as const;
  if (tpl.isActive === isActive) {
    // No-op: already in the requested state. Returning success keeps the
    // call idempotent so a double-click doesn't surface as an error.
    return { success: true, alreadySet: true } as const;
  }

  await db.workflowTemplate.update({
    where: { id },
    data: { isActive },
  });
  await logActivity(
    isActive ? "restored" : "archived",
    "workflow-template",
    id,
    user.id,
    tpl.name
  );
  revalidateWorkflowTemplate(id);
  return { success: true } as const;
}

export async function duplicateWorkflowTemplate(id: string) {
  const user = await requireAuth();
  const perms = await resolveModulePerms(user.id, user.role, "workflows");
  if (!perms.canCreate) return { error: "Permission denied" } as const;

  const original = await db.workflowTemplate.findUnique({
    where: { id },
    include: { steps: { orderBy: { position: "asc" } } },
  });
  if (!original) return { error: "Template not found" } as const;

  const copy = await db.workflowTemplate.create({
    data: {
      name: `Copy of ${original.name}`,
      description: original.description,
      type: original.type,
      subjectEntityType: original.subjectEntityType,
      isActive: true,
      isSeed: false,
      createdById: user.id,
      steps: {
        create: original.steps.map((s, i) => ({
          position: i,
          name: s.name,
          stepType: s.stepType,
          config: s.config,
          timingType: s.timingType,
          timingValue: s.timingValue,
          isRequired: s.isRequired,
          // Drop afterStepId — the FK targets the original template's
          // step ids and would create dangling references on the copy.
        })),
      },
    },
  });

  await logActivity("duplicated", "workflow-template", copy.id, user.id, copy.name);
  revalidateWorkflowTemplate(copy.id);
  return { success: true, id: copy.id } as const;
}

// ─── Steps CRUD ─────────────────────────────────────────────────────────

const stepTypeSchema = z.enum([
  "SEND_EMAIL",
  "ASSIGN_TASK_TO_SUBJECT",
  "ASSIGN_TASK_TO_USER",
  "REQUEST_DOCUMENT",
  "REQUEST_SIGNATURE",
  "REQUEST_FORM",
  "WAIT",
  "CONDITIONAL_BRANCH",
  "APPROVAL",
  "PROVISION_ACCESS",
  "DEPROVISION_ACCESS",
  "SCHEDULE_MEETING",
  "SEND_REMINDER",
]);

const timingTypeSchema = z.enum([
  "ON_ENTRY",
  "DAYS_AFTER_START",
  "DAYS_BEFORE_TARGET",
  "AFTER_STEP",
]);

const stepUpsertSchema = z.object({
  workflowTemplateId: z.string().min(1),
  name: z.string().min(1, "Step name is required"),
  stepType: stepTypeSchema,
  config: z.unknown(),
  timingType: timingTypeSchema.default("ON_ENTRY"),
  timingValue: z.number().int().default(0),
  afterStepId: z.string().nullish(),
  isRequired: z.boolean().default(true),
});

export async function addWorkflowStep(input: z.infer<typeof stepUpsertSchema>) {
  const user = await requireAuth();
  const perms = await resolveModulePerms(user.id, user.role, "workflows");
  if (!perms.canEdit) return { error: "Permission denied" } as const;

  const parsed = stepUpsertSchema.safeParse(input);
  if (!parsed.success) {
    return {
      error: "Invalid input",
      fieldErrors: parsed.error.flatten().fieldErrors,
    } as const;
  }

  const cfgValidation = validateStepConfig(
    parsed.data.stepType as WorkflowStepType,
    parsed.data.config
  );
  if (!cfgValidation.ok) return { error: cfgValidation.error } as const;

  const afterStepId = normalizeOptional(parsed.data.afterStepId ?? null);
  if (
    afterStepId &&
    (await wouldCreateAfterStepCycle(parsed.data.workflowTemplateId, null, afterStepId))
  ) {
    return {
      error: "Choosing that predecessor would create a cycle in the step ordering.",
    } as const;
  }

  // Append at the end of the template's steps.
  const lastStep = await db.workflowStep.findFirst({
    where: { workflowTemplateId: parsed.data.workflowTemplateId },
    orderBy: { position: "desc" },
    select: { position: true },
  });
  const position = (lastStep?.position ?? -1) + 1;

  const created = await db.workflowStep.create({
    data: {
      workflowTemplateId: parsed.data.workflowTemplateId,
      position,
      name: parsed.data.name,
      stepType: parsed.data.stepType as WorkflowStepType,
      config: JSON.stringify(cfgValidation.config),
      timingType: parsed.data.timingType as WorkflowTimingType,
      timingValue: parsed.data.timingValue,
      afterStepId: afterStepId,
      isRequired: parsed.data.isRequired,
    },
  });
  revalidateWorkflowTemplate(parsed.data.workflowTemplateId);
  return { success: true, id: created.id } as const;
}

export async function updateWorkflowStep(
  input: { id: string } & z.infer<typeof stepUpsertSchema>
) {
  const user = await requireAuth();
  const perms = await resolveModulePerms(user.id, user.role, "workflows");
  if (!perms.canEdit) return { error: "Permission denied" } as const;

  const parsed = stepUpsertSchema.safeParse(input);
  if (!parsed.success) {
    return {
      error: "Invalid input",
      fieldErrors: parsed.error.flatten().fieldErrors,
    } as const;
  }

  // Round-8 QA: edit-modal Save uses strict per-step-type schemas so
  // a step can't be persisted with blank required fields (e.g. an
  // ASSIGN_TASK_TO_SUBJECT with no title, which would later spawn a
  // Task with no description). addWorkflowStep keeps the draft
  // semantics so the picker still seeds default config rows.
  const cfgValidation = validateStepConfigStrict(
    parsed.data.stepType as WorkflowStepType,
    parsed.data.config
  );
  if (!cfgValidation.ok) {
    return {
      error: cfgValidation.error,
      fieldErrors: cfgValidation.fieldErrors,
    } as const;
  }

  const afterStepId = normalizeOptional(parsed.data.afterStepId ?? null);
  if (
    afterStepId &&
    (await wouldCreateAfterStepCycle(parsed.data.workflowTemplateId, input.id, afterStepId))
  ) {
    return {
      error: "Choosing that predecessor would create a cycle in the step ordering.",
    } as const;
  }

  await db.workflowStep.update({
    where: { id: input.id },
    data: {
      name: parsed.data.name,
      stepType: parsed.data.stepType as WorkflowStepType,
      config: JSON.stringify(cfgValidation.config),
      timingType: parsed.data.timingType as WorkflowTimingType,
      timingValue: parsed.data.timingValue,
      afterStepId: afterStepId,
      isRequired: parsed.data.isRequired,
    },
  });
  revalidateWorkflowTemplate(parsed.data.workflowTemplateId);
  return { success: true } as const;
}

export async function deleteWorkflowStep(id: string) {
  const user = await requireAuth();
  const perms = await resolveModulePerms(user.id, user.role, "workflows");
  if (!perms.canEdit) return { error: "Permission denied" } as const;

  const step = await db.workflowStep.findUnique({
    where: { id },
    select: { id: true, workflowTemplateId: true },
  });
  if (!step) return { error: "Step not found" } as const;

  await db.workflowStep.delete({ where: { id } });

  // Compact positions so deletion doesn't leave gaps that cause sort
  // jitter in the editor.
  const remaining = await db.workflowStep.findMany({
    where: { workflowTemplateId: step.workflowTemplateId },
    orderBy: { position: "asc" },
    select: { id: true },
  });
  await Promise.all(
    remaining.map((s, i) =>
      db.workflowStep.update({
        where: { id: s.id },
        data: { position: i },
      })
    )
  );
  revalidateWorkflowTemplate(step.workflowTemplateId);
  return { success: true } as const;
}

export async function reorderWorkflowSteps(
  templateId: string,
  orderedIds: string[]
) {
  const user = await requireAuth();
  const perms = await resolveModulePerms(user.id, user.role, "workflows");
  if (!perms.canEdit) return { error: "Permission denied" } as const;

  if (!Array.isArray(orderedIds) || orderedIds.length === 0) {
    return { error: "No order supplied" } as const;
  }

  // Verify every supplied id belongs to this template before writing —
  // a malicious payload mixing ids from different templates would
  // otherwise reposition rows the user shouldn't be touching.
  const owned = await db.workflowStep.findMany({
    where: { workflowTemplateId: templateId, id: { in: orderedIds } },
    select: { id: true },
  });
  const ownedIds = new Set(owned.map((s) => s.id));
  for (const id of orderedIds) {
    if (!ownedIds.has(id)) {
      return { error: "Reorder list contains foreign step id" } as const;
    }
  }

  await db.$transaction(
    orderedIds.map((id, i) =>
      db.workflowStep.update({
        where: { id },
        data: { position: i },
      })
    )
  );
  revalidateWorkflowTemplate(templateId);
  return { success: true } as const;
}

// ─── Step type metadata for the editor (server-side helper) ─────────────

export async function getStepTypeMetadata() {
  return STEP_TYPE_DEFINITIONS;
}
