import { db } from "@/lib/db";
import type { Role } from "@prisma/client";

/**
 * Computed visibility + management scope for a user.
 *
 * Two separate concepts to keep in mind:
 *
 *   canViewAll — true for roles that see every entity org-wide (ADMIN,
 *     DEVELOPER, MANAGER). Managers see all projects / clients / etc. on
 *     list pages; their access is only narrowed when *writing*.
 *
 *   canManageAll — true only for roles that can write everything regardless
 *     of assignment (ADMIN, DEVELOPER). Managers must be assigned to the
 *     specific entity to manage it.
 *
 * The per-entity Sets (projectIds, clientIds, …) are populated for *everyone
 * below canManageAll*, including managers — they drive the per-entity
 * management check via canManageEntity().
 */
export interface UserScope {
  role: Role;
  /** True when the user sees every entity org-wide. */
  canViewAll: boolean;
  /** True when the user can write / manage every entity org-wide. */
  canManageAll: boolean;
  /**
   * True when the user's sidebar + list pages should still be filtered by
   * the assigned-ID sets below. Equivalent to !canViewAll — kept for
   * readability in callers that ask "is this user scoped?".
   */
  all: boolean;
  projectIds: Set<string>;
  clientIds: Set<string>;
  contractIds: Set<string>;
  toolIds: Set<string>;
  certIds: Set<string>;
}

/** Roles that see everything on list pages / sidebar. */
const VIEW_ALL_ROLES: Role[] = ["ADMIN", "DEVELOPER", "MANAGER"];
/** Roles that can write everything regardless of assignment. */
const MANAGE_ALL_ROLES: Role[] = ["ADMIN", "DEVELOPER"];

export function hasOrgWideScope(role: Role): boolean {
  return VIEW_ALL_ROLES.includes(role);
}

export function hasOrgWideManage(role: Role): boolean {
  return MANAGE_ALL_ROLES.includes(role);
}

/**
 * Compute the user's visibility scope. Call this once per request and pass
 * the result to whatever needs it — don't call it in a loop.
 */
export async function getUserScope(
  userId: string,
  role: Role
): Promise<UserScope> {
  const canViewAll = VIEW_ALL_ROLES.includes(role);
  const canManageAll = MANAGE_ALL_ROLES.includes(role);

  // Admins + developers don't need the per-entity sets — they manage
  // everything regardless. Short-circuit to avoid the extra queries.
  if (canManageAll) {
    return {
      role,
      canViewAll: true,
      canManageAll: true,
      all: true,
      projectIds: new Set(),
      clientIds: new Set(),
      contractIds: new Set(),
      toolIds: new Set(),
      certIds: new Set(),
    };
  }

  // Everyone else (including managers, who see-all but manage-assigned-only)
  // needs the per-entity sets so canManageEntity() can check assignment.

  // ── Project visibility ────────────────────────────────────────
  // A user sees a project if any of these hold:
  //   - They're a ProjectMember (legacy team relation)
  //   - They have an active or planned Assignment on the project
  //   - They have an explicit EntityPermission row with canView
  const [members, assignments, entityPerms] = await Promise.all([
    db.projectMember.findMany({
      where: { userId },
      select: { projectId: true },
    }),
    db.assignment.findMany({
      where: {
        employeeId: userId,
        status: { in: ["ACTIVE", "PLANNED"] },
      },
      select: { projectId: true, clientId: true },
    }),
    db.entityPermission.findMany({
      where: { userId, canView: true },
      select: { entityType: true, entityId: true },
    }),
  ]);

  const projectIds = new Set<string>();
  for (const m of members) projectIds.add(m.projectId);
  for (const a of assignments) if (a.projectId) projectIds.add(a.projectId);
  for (const p of entityPerms)
    if (p.entityType === "project") projectIds.add(p.entityId);

  // ── Client visibility ─────────────────────────────────────────
  // Clients derive from: accountManagerId, any scoped project's client,
  // explicit entity permissions on the client, and staffing assignments
  // that reference the client directly.
  const clientIds = new Set<string>();
  for (const a of assignments) if (a.clientId) clientIds.add(a.clientId);
  for (const p of entityPerms)
    if (p.entityType === "client") clientIds.add(p.entityId);

  const [managedClients, scopedProjects] = await Promise.all([
    db.client.findMany({
      where: { accountManagerId: userId, deletedAt: null },
      select: { id: true },
    }),
    projectIds.size > 0
      ? db.project.findMany({
          where: { id: { in: Array.from(projectIds) }, deletedAt: null },
          select: { clientId: true },
        })
      : Promise.resolve([] as { clientId: string }[]),
  ]);
  for (const c of managedClients) clientIds.add(c.id);
  for (const p of scopedProjects) clientIds.add(p.clientId);

  // ── Certification visibility ──────────────────────────────────
  // Certs are admin/developer-only, but we still compute the set so
  // that scope-based checks remain consistent. Only direct assignment
  // (assignee / POC) or explicit entity permission grants visibility.
  const certOrClauses: object[] = [
    { assigneeId: userId },
    { pointOfContactId: userId },
  ];
  for (const p of entityPerms) {
    if (p.entityType === "certification") certOrClauses.push({ id: p.entityId });
  }
  const certRows = await db.certification.findMany({
    where: { OR: certOrClauses, deletedAt: null },
    select: { id: true },
  });
  const certIds = new Set(certRows.map((c) => c.id));

  // ── Contract visibility ───────────────────────────────────────
  // Contracts are only visible when directly linked to an assigned
  // project or granted via explicit entity permission. We intentionally
  // do NOT fan out through clientIds — seeing a client doesn't
  // automatically grant access to all contracts for that client.
  const contractIds = new Set<string>();
  for (const p of entityPerms) {
    if (p.entityType === "contract") contractIds.add(p.entityId);
  }
  if (projectIds.size > 0) {
    const contracts = await db.contract.findMany({
      where: { projectId: { in: Array.from(projectIds) }, deletedAt: null },
      select: { id: true },
    });
    for (const c of contracts) contractIds.add(c.id);
  }

  // ── Tool visibility ───────────────────────────────────────────
  // Tools are attached to projects via ProjectTool. A tool is visible if
  // it's linked to at least one project the user can see, or via explicit
  // entity permission.
  const toolIds = new Set<string>();
  for (const p of entityPerms) {
    if (p.entityType === "tool") toolIds.add(p.entityId);
  }
  if (projectIds.size > 0) {
    const projectTools = await db.projectTool.findMany({
      where: { projectId: { in: Array.from(projectIds) } },
      select: { toolId: true },
    });
    for (const pt of projectTools) toolIds.add(pt.toolId);
  }

  return {
    role,
    canViewAll,
    canManageAll: false,
    // `all` is true only for roles that truly see everything from the
    // visibility side — managers see all too, so they use `all=true` and
    // leaf list pages skip scope filtering.
    all: canViewAll,
    projectIds,
    clientIds,
    contractIds,
    toolIds,
    certIds,
  };
}

type ScopeEntityType = "project" | "client" | "contract" | "tool" | "certification";

function scopeSetFor(scope: UserScope, entityType: ScopeEntityType): Set<string> {
  switch (entityType) {
    case "project":
      return scope.projectIds;
    case "client":
      return scope.clientIds;
    case "contract":
      return scope.contractIds;
    case "tool":
      return scope.toolIds;
    case "certification":
      return scope.certIds;
  }
}

/**
 * Guard helper for detail pages. Returns true when the user can view the
 * given entity under their computed scope. ADMIN / DEVELOPER / MANAGER
 * always pass.
 */
export function canViewEntity(
  scope: UserScope,
  entityType: ScopeEntityType,
  id: string
): boolean {
  if (scope.canViewAll) return true;
  return scopeSetFor(scope, entityType).has(id);
}

/**
 * Can the user write / manage this specific entity? ADMIN and DEVELOPER
 * always pass. MANAGER and CONTRIBUTOR pass only when the entity is in
 * their assigned set. VIEWER and GUEST never pass.
 */
export function canManageEntity(
  scope: UserScope,
  entityType: ScopeEntityType,
  id: string
): boolean {
  if (scope.canManageAll) return true;
  if (scope.role !== "MANAGER" && scope.role !== "CONTRIBUTOR") return false;
  return scopeSetFor(scope, entityType).has(id);
}
