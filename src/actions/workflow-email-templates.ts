"use server";

import { db } from "@/lib/db";
import {
  requireAuth,
  resolveModulePerms,
  type PermissionFlags,
} from "@/lib/permissions";
import { logActivity } from "@/lib/activity";
import { revalidateWorkflowEmailTemplate } from "@/lib/revalidate-entity";
import { SUGGESTED_VARIABLES } from "@/lib/workflows/step-types";
import { z } from "zod";

const emailTemplateSchema = z.object({
  name: z.string().min(1, "Name is required"),
  subject: z.string().min(1, "Subject is required"),
  bodyHtml: z.string().min(1, "Body is required"),
  bodyText: z.string().nullish(),
});

function normalizeOptional(v: string | null | undefined): string | null {
  if (v == null) return null;
  const t = String(v).trim();
  return t.length === 0 ? null : t;
}

/**
 * Email templates feed raw HTML into outbound mail, so authoring them
 * is a management operation — role defaults hand every CONTRIBUTOR
 * canEdit/canCreate on the workflows module, which must not be enough
 * here. Mirrors canDriveInstances in workflow-instances.ts.
 */
function canAuthorEmailTemplates(role: string, perms: PermissionFlags): boolean {
  return perms.canManage || (role === "MANAGER" && perms.canEdit);
}

export async function createWorkflowEmailTemplate(
  input: z.infer<typeof emailTemplateSchema>
) {
  const user = await requireAuth();
  const perms = await resolveModulePerms(user.id, user.role, "workflows");
  if (!canAuthorEmailTemplates(user.role, perms)) {
    return { error: "Permission denied" } as const;
  }

  const parsed = emailTemplateSchema.safeParse(input);
  if (!parsed.success) {
    return {
      error: "Invalid input",
      fieldErrors: parsed.error.flatten().fieldErrors,
    } as const;
  }

  const tpl = await db.workflowEmailTemplate.create({
    data: {
      name: parsed.data.name,
      subject: parsed.data.subject,
      bodyHtml: parsed.data.bodyHtml,
      bodyText: normalizeOptional(parsed.data.bodyText ?? null),
      // Stash the suggested variable list at creation time so the
      // editor's autocomplete works even if the canonical list moves.
      // The list is short and pure data, so embedding once is fine.
      availableVariables: JSON.stringify(SUGGESTED_VARIABLES.map((v) => v.path)),
      createdById: user.id,
    },
  });
  await logActivity("created", "workflow-email-template", tpl.id, user.id, tpl.name);
  revalidateWorkflowEmailTemplate(tpl.id);
  return { success: true, id: tpl.id } as const;
}

export async function updateWorkflowEmailTemplate(
  input: { id: string } & z.infer<typeof emailTemplateSchema>
) {
  const user = await requireAuth();
  const perms = await resolveModulePerms(user.id, user.role, "workflows");
  if (!canAuthorEmailTemplates(user.role, perms)) {
    return { error: "Permission denied" } as const;
  }

  const parsed = emailTemplateSchema.safeParse(input);
  if (!parsed.success) {
    return {
      error: "Invalid input",
      fieldErrors: parsed.error.flatten().fieldErrors,
    } as const;
  }

  const existing = await db.workflowEmailTemplate.findUnique({
    where: { id: input.id },
    select: { id: true },
  });
  if (!existing) return { error: "Template not found" } as const;

  const tpl = await db.workflowEmailTemplate.update({
    where: { id: input.id },
    data: {
      name: parsed.data.name,
      subject: parsed.data.subject,
      bodyHtml: parsed.data.bodyHtml,
      bodyText: normalizeOptional(parsed.data.bodyText ?? null),
    },
  });
  await logActivity("updated", "workflow-email-template", tpl.id, user.id, tpl.name);
  revalidateWorkflowEmailTemplate(tpl.id);
  return { success: true } as const;
}

export async function deleteWorkflowEmailTemplate(id: string) {
  const user = await requireAuth();
  const perms = await resolveModulePerms(user.id, user.role, "workflows");
  if (!canAuthorEmailTemplates(user.role, perms)) {
    return { error: "Permission denied" } as const;
  }

  // Phase 4 will need to refuse delete when a step references the
  // template — for now we just delete and let the FK on the step's
  // `config` JSON go stale (config is a JSON blob, not an FK).
  await db.workflowEmailTemplate.delete({ where: { id } });
  await logActivity("deleted", "workflow-email-template", id, user.id);
  revalidateWorkflowEmailTemplate(id);
  return { success: true } as const;
}
