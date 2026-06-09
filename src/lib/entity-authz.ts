import type { Role } from "@prisma/client";
import {
  getUserScope,
  canManageEntity,
  hasOrgWideManage,
  type ScopeEntityType,
  type UserScope,
} from "@/lib/scope";

/**
 * Write-gate for mutations on scoped entities (projects, clients,
 * contracts, tools, certifications).
 *
 * The read side of the permission model is enforced on detail pages via
 * canViewEntity(); this is the matching write side. canManageEntity()
 * documents the contract — "MANAGER and CONTRIBUTOR pass only when the
 * entity is in their assigned set" — but historically no server action
 * called it, so any CONTRIBUTOR with module-level canEdit could mutate
 * any entity org-wide by POSTing the action directly with an arbitrary
 * id. Every update/delete action on a scoped entity must call this
 * after its module-permission check.
 *
 * Returns null when the actor may write the entity, or an { error }
 * object the action can return directly. Pass a precomputed scope when
 * the caller already has one to avoid a duplicate getUserScope() round
 * trip.
 */
export async function assertManageEntity(
  userId: string,
  role: Role,
  entityType: ScopeEntityType,
  entityId: string,
  precomputedScope?: UserScope
): Promise<{ error: string } | null> {
  if (hasOrgWideManage(role)) return null;
  const scope = precomputedScope ?? (await getUserScope(userId, role));
  if (canManageEntity(scope, entityType, entityId)) return null;
  return { error: "You don't have access to modify this item" };
}
