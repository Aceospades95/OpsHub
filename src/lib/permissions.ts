import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import type { Role } from "@prisma/client";
import { redirect } from "next/navigation";
import { getPermissionedModules } from "@/lib/modules";

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
  if (role === "ADMIN") {
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

  return getRoleDefaults(role);
}

export async function resolveEntityPerms(
  userId: string,
  role: Role,
  module: string,
  entityType: string,
  entityId: string
): Promise<PermissionFlags> {
  if (role === "ADMIN") {
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

  // Fall back to module perms
  return resolveModulePerms(userId, role, module);
}

export function canAccessSandbox(role: Role): boolean {
  return role === "ADMIN" || role === "DEVELOPER";
}

export async function getVisibleModules(
  userId: string,
  role: Role
): Promise<string[]> {
  // Drive visibility from the module registry so adding a new permissioned
  // module automatically adds it to the visible list without editing this file.
  const permissioned = getPermissionedModules();

  if (role === "ADMIN") return permissioned.map((m) => m.key);

  const visible: string[] = [];
  for (const mod of permissioned) {
    // Admin-only modules are never visible to non-ADMIN users regardless
    // of their individual module permission rows.
    if (mod.adminOnly) continue;
    const perms = await resolveModulePerms(userId, role, mod.key);
    if (perms.canView) visible.push(mod.key);
  }
  return visible;
}
