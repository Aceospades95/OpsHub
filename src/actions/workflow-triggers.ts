"use server";

import { db } from "@/lib/db";
import { requireAuth, resolveModulePerms } from "@/lib/permissions";
import { revalidateWorkflowTemplate } from "@/lib/revalidate-entity";
import { z } from "zod";
import type { WorkflowTriggerType } from "@prisma/client";

const triggerTypeSchema = z.enum([
  "ENTITY_CREATE",
  "SCHEDULED_DATE",
  "STAGE_CHANGE",
  "PROJECT_ASSIGNMENT",
]);

const upsertSchema = z.object({
  workflowTemplateId: z.string().min(1),
  triggerType: triggerTypeSchema,
  config: z.record(z.unknown()),
  isActive: z.boolean().optional(),
});

export async function createWorkflowTrigger(input: z.infer<typeof upsertSchema>) {
  const user = await requireAuth();
  const perms = await resolveModulePerms(user.id, user.role, "workflows");
  if (!perms.canEdit) return { error: "Permission denied" } as const;

  const parsed = upsertSchema.safeParse(input);
  if (!parsed.success) {
    return {
      error: "Invalid input",
      fieldErrors: parsed.error.flatten().fieldErrors,
    } as const;
  }

  const template = await db.workflowTemplate.findUnique({
    where: { id: parsed.data.workflowTemplateId },
    select: { id: true },
  });
  if (!template) return { error: "Template not found" } as const;

  const created = await db.workflowTrigger.create({
    data: {
      workflowTemplateId: parsed.data.workflowTemplateId,
      triggerType: parsed.data.triggerType as WorkflowTriggerType,
      config: JSON.stringify(parsed.data.config),
      isActive: parsed.data.isActive ?? true,
    },
  });
  revalidateWorkflowTemplate(parsed.data.workflowTemplateId);
  return { success: true, id: created.id } as const;
}

export async function updateWorkflowTrigger(
  input: { id: string } & z.infer<typeof upsertSchema>
) {
  const user = await requireAuth();
  const perms = await resolveModulePerms(user.id, user.role, "workflows");
  if (!perms.canEdit) return { error: "Permission denied" } as const;

  const parsed = upsertSchema.safeParse(input);
  if (!parsed.success) {
    return {
      error: "Invalid input",
      fieldErrors: parsed.error.flatten().fieldErrors,
    } as const;
  }

  // The trigger must exist and belong to the supplied template id —
  // revalidation keys off the template, and a mismatched pair would
  // also turn a missing row into a raw P2025 500.
  const existing = await db.workflowTrigger.findUnique({
    where: { id: input.id },
    select: { workflowTemplateId: true },
  });
  if (!existing) return { error: "Trigger not found" } as const;
  if (existing.workflowTemplateId !== parsed.data.workflowTemplateId) {
    return { error: "Trigger does not belong to this template" } as const;
  }

  await db.workflowTrigger.update({
    where: { id: input.id },
    data: {
      triggerType: parsed.data.triggerType as WorkflowTriggerType,
      config: JSON.stringify(parsed.data.config),
      isActive: parsed.data.isActive ?? true,
    },
  });
  revalidateWorkflowTemplate(parsed.data.workflowTemplateId);
  return { success: true } as const;
}

export async function deleteWorkflowTrigger(id: string) {
  const user = await requireAuth();
  const perms = await resolveModulePerms(user.id, user.role, "workflows");
  if (!perms.canEdit) return { error: "Permission denied" } as const;
  const t = await db.workflowTrigger.findUnique({
    where: { id },
    select: { id: true, workflowTemplateId: true },
  });
  if (!t) return { error: "Trigger not found" } as const;
  await db.workflowTrigger.delete({ where: { id } });
  revalidateWorkflowTemplate(t.workflowTemplateId);
  return { success: true } as const;
}
