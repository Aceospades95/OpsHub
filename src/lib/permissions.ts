import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import type { Role } from "@prisma/client";
import { redirect } from "next/navigation";
import { getPermissionedModules } from "@/lib/modules";
import { getUserScope, hasOrgWideManage } from "@/lib/scope";

export type PermissionFlags = {
  canView: boolean;
  canEdit: boolean;
  canCreate: boolean;
  canDelete: boolean;
  canComment: boolean;
  canUpload: boolean;
  canManage: boolean;
};

const ROLE_LEVEL: Record<Role, number> = {
  ADMIN: 4,
  MANAGER: 3,
  DEVELOPER: 3,
  CONTRIBUTOR: 2,
  VIEWER: 1,
  GUEST: 0,
};

/**
 * Modules a GUEST can see out-of-the-box. Everything else requires either a
 * role upgrade, an explicit module permission row, or an entity grant (e.g.
 * a project assignment).
 */
const GUEST_VISIBLE_MODULES = new Set(["intranet", "team", "dashboard", "tasks"]);

/**
 * Map from module key to the scope set that gates sidebar visibility. Modules
 * not listed here (team, intranet, dashboard, tasks) aren't entity-scoped —
 * they're always on if the role allows canView.
 */
const SCOPED_MODULES: Record<string, "projectIds" | "clientIds" | "contractIds" | "toolIds" | "certIds"> = {
  projects: "projectIds",
  clients: "clientIds",
  contracts: "contractIds",
  tools: "toolIds",
  certifications: "certIds",
};

/**
 * Modules a field-tier user (CONTRIBUTOR / VIEWER) can use out of the box,
 * with the flags CONTRIBUTOR gets on each (VIEWER gets the canView bits
 * only). Everything NOT listed here defaults to NO access for the field
 * tier — quotes, contracts, suppliers, subcontractors, partnerships,
 * workflows, certifications, and custom pages are opt-in via an explicit
 * ModulePermission row or an entity grant.
 *
 * This is the July 2026 access rework: the old defaults granted every
 * VIEWER+ canView (and every CONTRIBUTOR+ canEdit/canCreate) on EVERY
 * permissioned module, which exposed quote totals, contract values, and
 * subcontractor rates to field accounts. See
 * docs/codebase-audit-2026-07.md §6 for the full leak list this closes.
 */
const FIELD_MODULE_DEFAULTS: Record<string, Partial<PermissionFlags>> = {
  tasks: { canView: true, canEdit: true, canCreate: true, canComment: true, canUpload: true },
  // Scoped modules: the list pages additionally filter to the user's
  // assigned entities, so canView here means "their own", not org-wide.
  projects: { canView: true, canComment: true, canUpload: true },
  clients: { canView: true, canComment: true },
  tools: { canView: true },
  team: { canView: true },
  intranet: { canView: true },
};

export function getRoleDefaults(role: Role, module: string): PermissionFlags {
  const level = ROLE_LEVEL[role];

  // MANAGER (and the legacy DEVELOPER, though it short-circuits earlier
  // via hasOrgWideManage) — org-wide operational access to every module.
  if (level >= 3) {
    return {
      canView: true,
      canEdit: true,
      canCreate: true,
      canDelete: true,
      canComment: true,
      canUpload: true,
      canManage: level >= 4,
    };
  }

  if (role === "GUEST") return getGuestModuleDefaults(module);

  // Field tier (CONTRIBUTOR, plus legacy VIEWER as its read-only variant):
  // deny-by-default allow-list.
  const grants = FIELD_MODULE_DEFAULTS[module];
  const canWrite = level >= 2;
  return {
    canView: Boolean(grants?.canView),
    canEdit: Boolean(grants?.canEdit) && canWrite,
    canCreate: Boolean(grants?.canCreate) && canWrite,
    canDelete: false,
    canComment: Boolean(grants?.canComment) && canWrite,
    canUpload: Boolean(grants?.canUpload) && canWrite,
    canManage: false,
  };
}

/**
 * Guests have no default module access. They only see modules explicitly
 * listed in GUEST_VISIBLE_MODULES (intranet + team) unless an admin grants
 * them a module permission row or assigns them to a project.
 */
function getGuestModuleDefaults(module: string): PermissionFlags {
  const canView = GUEST_VISIBLE_MODULES.has(module);
  return {
    canView,
    canEdit: false,
    canCreate: false,
    canDelete: false,
    canComment: false,
    canUpload: false,
    canManage: false,
  };
}

export async function requireAuth() {
  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }
  // The JWT caches the role from sign-in time; server-side changes (auto-
  // promotion via assignment, admin edits) aren't reflected there because
  // the jwt callback runs in Edge Runtime where Prisma is unavailable.
  // Always re-read the current role so pages see the up-to-date value.
  const freshUser = await db.user.findUnique({
    where: { id: session.user.id },
    select: { role: true },
  });
  if (freshUser) session.user.role = freshUser.role;
  return session.user;
}

export async function resolveModulePerms(
  userId: string,
  role: Role,
  module: string
): Promise<PermissionFlags> {
  // ADMIN and DEVELOPER both see + manage everything org-wide.
  if (hasOrgWideManage(role)) {
    return {
      canView: true,
      canEdit: true,
      canCreate: true,
      canDelete: true,
      canComment: true,
      canUpload: true,
      canManage: true,
    };
  }

  // Start with role-based defaults (GUEST handled inside).
  const base: PermissionFlags = getRoleDefaults(role, module);

  // An explicit module-permission row overrides the role defaults.
  const modulePerm = await db.modulePermission.findUnique({
    where: { userId_module: { userId, module } },
  });

  const effective: PermissionFlags = modulePerm
    ? {
        canView: modulePerm.canView,
        canEdit: modulePerm.canEdit,
        canCreate: modulePerm.canCreate,
        canDelete: modulePerm.canDelete,
        canComment: modulePerm.canComment,
        canUpload: modulePerm.canUpload,
        canManage: modulePerm.canManage,
      }
    : base;

  // For entity-scoped modules (projects, clients, contracts, tools, certs):
  // if the user has at least one entity in scope (via assignment, membership,
  // or entity permission), grant canView + canComment regardless of role or
  // module-permission rows. Assignments are the source of truth for access.
  // Note: for the field tier, scope.contractIds only ever contains
  // EXPLICIT entity grants (see getUserScope) — a project assignment no
  // longer fans out to the project's contracts, so this path can't
  // re-open contracts that the role defaults above deny.
  const scopeKey = SCOPED_MODULES[module];
  if (scopeKey && !effective.canView) {
    const scope = await getUserScope(userId, role);
    const set = scope[scopeKey];
    if (set instanceof Set && set.size > 0) {
      return { ...effective, canView: true, canComment: true };
    }
  }

  return effective;
}

export async function resolveEntityPerms(
  userId: string,
  role: Role,
  module: string,
  entityType: string,
  entityId: string
): Promise<PermissionFlags> {
  // ADMIN and DEVELOPER manage every entity org-wide.
  if (hasOrgWideManage(role)) {
    return {
      canView: true,
      canEdit: true,
      canCreate: true,
      canDelete: true,
      canComment: true,
      canUpload: true,
      canManage: true,
    };
  }

  // Check entity-level first
  const entityPerm = await db.entityPermission.findUnique({
    where: {
      userId_entityType_entityId: { userId, entityType, entityId },
    },
  });

  if (entityPerm) {
    return {
      canView: entityPerm.canView,
      canEdit: entityPerm.canEdit,
      canCreate: false, // entity perms don't control create
      canDelete: false,
      canComment: entityPerm.canComment,
      canUpload: entityPerm.canUpload,
      canManage: entityPerm.canManage,
    };
  }

  // For projects: an active assignment grants view + comment access even
  // without explicit entity or module permissions. This ties the staffing
  // matrix to the permission system — assign someone to a project and
  // they automatically get access.
  if (entityType === "project") {
    const assignment = await db.assignment.findFirst({
      where: {
        employeeId: userId,
        projectId: entityId,
        status: { in: ["ACTIVE", "PLANNED"] },
      },
      select: { id: true },
    });
    if (assignment) {
      const modulePerms = await resolveModulePerms(userId, role, module);
      return {
        ...modulePerms,
        canView: true,
        canComment: true,
      };
    }
  }

  // Fall back to module perms
  return resolveModulePerms(userId, role, module);
}

/**
 * Check whether a user has access to a specific project — either through
 * explicit permissions or through an active staffing assignment.
 *
 * This is the query used by project list views to filter which projects
 * a non-admin user can see.
 */
export async function getAccessibleProjectIds(
  userId: string,
  role: Role
): Promise<string[] | "all"> {
  // ADMIN, DEVELOPER, MANAGER all see every project on list pages.
  if (role === "ADMIN" || role === "DEVELOPER" || role === "MANAGER") return "all";

  // Projects the user is actively assigned to (staffing)
  const assignments = await db.assignment.findMany({
    where: {
      employeeId: userId,
      status: { in: ["ACTIVE", "PLANNED"] },
      projectId: { not: null },
    },
    select: { projectId: true },
  });

  // Projects with explicit entity permission
  const entityPerms = await db.entityPermission.findMany({
    where: {
      userId,
      entityType: "project",
      canView: true,
    },
    select: { entityId: true },
  });

  // Projects through project membership (legacy relation)
  const members = await db.projectMember.findMany({
    where: { userId },
    select: { projectId: true },
  });

  const ids = new Set<string>();
  for (const a of assignments) {
    if (a.projectId) ids.add(a.projectId);
  }
  for (const p of entityPerms) ids.add(p.entityId);
  for (const m of members) ids.add(m.projectId);

  return Array.from(ids);
}

export function canAccessSandbox(role: Role): boolean {
  return role === "ADMIN" || role === "DEVELOPER";
}

/**
 * Coarse "can this role manage staffing at all?" check. Used for quick
 * sidebar / button visibility. Fine-grained per-project authorization uses
 * canManageProjectAssignments below — a manager who isn't assigned to a
 * particular project can't manage that project's members.
 */
export function canManageAssignments(role: Role): boolean {
  return role === "ADMIN" || role === "DEVELOPER" || role === "MANAGER";
}

/**
 * Can this specific user add / remove members + assignments on this
 * specific project? ADMIN and DEVELOPER always pass. MANAGER passes only
 * when they're assigned to the project in question.
 */
export async function canManageProjectAssignments(
  userId: string,
  role: Role,
  projectId: string
): Promise<boolean> {
  if (hasOrgWideManage(role)) return true;
  if (role !== "MANAGER") return false;
  const scope = await getUserScope(userId, role);
  return scope.projectIds.has(projectId);
}

export async function getVisibleModules(
  userId: string,
  role: Role
): Promise<string[]> {
  // Drive visibility from the module registry so adding a new permissioned
  // module automatically adds it to the visible list without editing this file.
  const permissioned = getPermissionedModules();

  // ADMIN + DEVELOPER see every permissioned module in the sidebar.
  if (hasOrgWideManage(role)) return permissioned.map((m) => m.key);

  // For MANAGER and everyone else, hide entity-backed modules when the user
  // has zero scoped entities for that module. This prevents empty sidebar
  // items for, e.g., a contributor who isn't on any project yet. MANAGER
  // has scope.all=true so they skip the empty-scope filter.
  const scope = await getUserScope(userId, role);

  const visible: string[] = [];
  for (const mod of permissioned) {
    // Admin-only modules are never visible to non-ADMIN users regardless
    // of their individual module permission rows.
    if (mod.adminOnly) continue;
    const perms = await resolveModulePerms(userId, role, mod.key);
    if (!perms.canView) continue;

    // If the module is entity-scoped and the user is not org-wide, require
    // at least one entity in scope for the module to appear in the sidebar.
    const scopeKey = SCOPED_MODULES[mod.key];
    if (scopeKey && !scope.all) {
      const set = scope[scopeKey];
      if (set instanceof Set && set.size === 0) continue;
    }

    visible.push(mod.key);
  }
  return visible;
}
