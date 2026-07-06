import { db } from "@/lib/db";
import type { Role } from "@prisma/client";
import { isHrRole } from "@/lib/disciplinary";

/**
 * Entity types whose activity rows must not reach viewers outside the
 * HR roles (ADMIN / MANAGER). The rows themselves store only safe
 * summaries (action-type labels, never the incident text or employee
 * name), but even "a disciplinary report was created" is not for the
 * field tier or legacy DEVELOPER accounts.
 */
export const HR_SENSITIVE_ENTITY_TYPES = ["disciplinary-report"];

/**
 * Where-clause fragment every user-facing ActivityLog query must spread
 * in. Admin-only surfaces (/admin/activity and its CSV export) may skip
 * it. `notIn: []` matches everything, so HR roles get the full feed.
 */
export function activityVisibilityWhere(role: Role): {
  entityType: { notIn: string[] };
} {
  return { entityType: { notIn: isHrRole(role) ? [] : HR_SENSITIVE_ENTITY_TYPES } };
}

export async function logActivity(
  action: string,
  entityType: string,
  entityId: string,
  userId: string,
  details?: string,
  options?: { projectId?: string | null; clientId?: string | null }
) {
  await db.activityLog.create({
    data: {
      action,
      entityType,
      entityId,
      userId,
      details,
      projectId: options?.projectId ?? null,
      clientId: options?.clientId ?? null,
    },
  });
}
