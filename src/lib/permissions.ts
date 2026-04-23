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

export function getRoleDefaults(role: Role): PermissionFlags {
  const level = ROLE_LEVEL[role];
  return {
    canView: level >= 1,
    canEdit: level >= 2,
    canCreate: level >= 2,
    canDelete: level >= 3,
    canComment: level >= 2,
    canUpload: level >= 2,
    canManage: level >= 4,
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

  const modulePerm = await db.modulePermission.findUnique({
    where: { userId_module: { userId, module } },
  });

  if (modulePerm) {
    return {
      canView: modulePerm.canView,
      canEdit: modulePerm.canEdit,
      canCreate: modulePerm.canCreate,
      canDelete: modulePerm.canDelete,
      canComment: modulePerm.canComment,
      canUpload: modulePerm.canUpload,
      canManage: modulePerm.canManage,
    };
  }

  if (role === "GUEST") {
    // If the module is entity-scoped and the user has at least one entity in
    // scope (e.g. via a project assignment or account-manager row), grant
    // view + comment so assigned guests can actually see Projects / Clients /
    // Contracts / Tools / Certifications in their sidebar and load the pages.
    const scopeKey = SCOPED_MODULES[module];
    if (scopeKey) {
      const scope = await getUserScope(userId, role);
      const set = scope[scopeKey];
      if (set instanceof Set && set.size > 0) {
        return {
          canView: true,
          canEdit: false,
          canCreate: false,
          canDelete: false,
          canComment: true,
          canUpload: false,
          canManage: false,
        };
      }
    }
    return getGuestModuleDefaults(module);
  }

  return getRoleDefaults(role);
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
