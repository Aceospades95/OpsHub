"use server";

import { db } from "@/lib/db";
import { requireAuth } from "@/lib/permissions";
import { logActivity } from "@/lib/activity";
import { revalidatePath } from "next/cache";
import { revalidateUser } from "@/lib/revalidate-entity";
import { getPermissionedModules, ALL_PERMISSION_FLAGS } from "@/lib/modules";
import { sendFromTemplate } from "@/lib/email";
import { absoluteUrl } from "@/lib/url";
import { hash } from "bcryptjs";
import { z } from "zod";

function requireAdminOrManager(role: string) {
  if (role !== "ADMIN" && role !== "MANAGER") throw new Error("Admin or Manager access required");
}

const createUserSchema = z.object({
  name: z.string().min(2, "Name required"),
  email: z.string().email("Invalid email").optional(),
  password: z.string().min(6, "Min 6 chars").optional(),
  role: z.enum(["ADMIN", "MANAGER", "DEVELOPER", "CONTRIBUTOR", "VIEWER", "GUEST"]),
  department: z.string().optional(),
  jobTitle: z.string().optional(),
  location: z.string().optional(),
  phone: z.string().optional(),
  managerId: z.string().optional(),
  hasLoginAccess: z.boolean().optional(),
});

export async function createUser(_prev: unknown, formData: FormData) {
  const admin = await requireAuth();
  requireAdminOrManager(admin.role);

  const hasLogin = formData.get("hasLoginAccess") !== "false";
  // Normalize email to lowercase so login is case-insensitive and we never
  // end up with two rows for the same address differing only in case.
  const emailRaw = (formData.get("email") as string)?.trim().toLowerCase();
  const passwordRaw = (formData.get("password") as string)?.trim();

  // For login users, email and password are required
  if (hasLogin && !emailRaw) return { error: "Email is required for users with login access" };
  if (hasLogin && (!passwordRaw || passwordRaw.length < 6)) return { error: "Password must be at least 6 characters" };

  const parsed = createUserSchema.safeParse({
    name: formData.get("name"),
    email: emailRaw || undefined,
    password: passwordRaw || undefined,
    role: formData.get("role") || "VIEWER",
    department: formData.get("department") || undefined,
    jobTitle: formData.get("jobTitle") || undefined,
    phone: formData.get("phone") || undefined,
    location: formData.get("location") || undefined,
    managerId: formData.get("managerId") || undefined,
    hasLoginAccess: hasLogin,
  });

  if (!parsed.success) return { error: "Invalid input", fieldErrors: parsed.error.flatten().fieldErrors };

  // Generate placeholder email for no-login users
  const email = parsed.data.email || `nologin-${Date.now()}@internal.local`;
  const existing = await db.user.findUnique({ where: { email } });
  if (existing) return { error: "Email already exists" };

  const hashedPassword = parsed.data.password
    ? await hash(parsed.data.password, 12)
    : await hash(`noaccess-${Date.now()}`, 12);

  const { password: _pw, email: _email, ...rest } = parsed.data;

  const user = await db.user.create({
    data: { ...rest, email, hashedPassword, hasLoginAccess: hasLogin },
  });

  await logActivity("created", "user", user.id, admin.id, user.name);
  revalidateUser(user.id, { managerId: user.managerId });

  // Send a welcome email to login-enabled users so they know their account
  // exists and where to sign in. No-login placeholder users (e.g., tracked
  // employees who don't actually use the system) skip this since their
  // email column is a fake placeholder.
  if (hasLogin && parsed.data.email) {
    try {
      await sendFromTemplate(
        "welcome",
        {
          name: user.name,
          loginUrl: absoluteUrl("/login"),
        },
        {
          to: user.email,
          entityType: "user",
          entityId: user.id,
        }
      );
    } catch (err) {
      // Don't fail user creation if the welcome email errors out — the
      // failure is logged in EmailLog and visible at /admin/emails
      // eslint-disable-next-line no-console
      console.error("[admin] welcome email failed:", err);
    }
  }

  // Fire ENTITY_CREATE workflow triggers — onboarding workflows that
  // are configured to auto-start on new-employee creation. Errors here
  // never block the create itself; a stuck workflow is recoverable, a
  // lost employee row isn't.
  try {
    const { fireEntityCreateTriggers } = await import("@/lib/workflows/triggers");
    await fireEntityCreateTriggers({
      entityType: "User",
      entityId: user.id,
      createdById: admin.id,
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[admin] workflow auto-trigger failed:", err);
  }

  return { success: true };
}

const updateUserSchema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  role: z.enum(["ADMIN", "MANAGER", "DEVELOPER", "CONTRIBUTOR", "VIEWER", "GUEST"]),
  department: z.string().optional(),
  jobTitle: z.string().optional(),
  location: z.string().optional(),
  phone: z.string().optional(),
  managerId: z.string().optional(),
  isActive: z.boolean().optional(),
  hasLoginAccess: z.boolean().optional(),
});

export async function updateUser(_prev: unknown, formData: FormData) {
  const admin = await requireAuth();
  requireAdminOrManager(admin.role);

  const id = formData.get("id") as string;
  const rawManagerId = formData.get("managerId") as string;
  const managerId = rawManagerId && rawManagerId.trim() ? rawManagerId.trim() : null;
  const emailRaw = ((formData.get("email") as string) || "").trim().toLowerCase();

  const parsed = updateUserSchema.safeParse({
    name: formData.get("name"),
    email: emailRaw,
    role: formData.get("role"),
    department: formData.get("department") || undefined,
    jobTitle: formData.get("jobTitle") || undefined,
    location: formData.get("location") || undefined,
    phone: formData.get("phone") || undefined,
    managerId: managerId || undefined,
    isActive: formData.get("isActive") !== "false",
  });

  if (!parsed.success) return { error: "Invalid input", fieldErrors: parsed.error.flatten().fieldErrors };

  // Validate no circular manager chain
  if (managerId) {
    if (managerId === id) {
      return { error: "A user cannot report to themselves" };
    }
    // Walk up the chain from the proposed manager to check for cycles
    let checkId: string | null = managerId;
    const visited = new Set<string>([id]);
    while (checkId) {
      if (visited.has(checkId)) {
        return { error: "This would create a circular reporting chain" };
      }
      visited.add(checkId);
      const parent: { managerId: string | null } | null = await db.user.findUnique({ where: { id: checkId }, select: { managerId: true } });
      checkId = parent?.managerId ?? null;
    }
  }

  // Look up the previous manager + role so we can revalidate their page too
  // if it changed, and decide whether this was a manual role change (which
  // should clear the auto-promotion marker).
  const previous = await db.user.findUnique({
    where: { id },
    select: { managerId: true, role: true, promotedFromRole: true },
  });

  // If an admin explicitly changed the role, treat the new role as the
  // user's chosen level — drop the promotedFromRole so they won't be
  // auto-demoted later by assignment removal.
  const roleChanged = previous && previous.role !== parsed.data.role;
  const promotedFromRoleUpdate =
    roleChanged && previous?.promotedFromRole
      ? { promotedFromRole: null }
      : {};

  // Use null instead of undefined to actually clear the field
  await db.user.update({
    where: { id },
    data: { ...parsed.data, managerId: managerId, ...promotedFromRoleUpdate },
  });
  await logActivity("updated", "user", id, admin.id, parsed.data.name);
  revalidateUser(id, {
    managerId,
    previousManagerId: previous?.managerId ?? null,
  });
  return { success: true };
}

export async function deleteUser(_prev: unknown, formData: FormData) {
  const admin = await requireAuth();
  requireAdminOrManager(admin.role);

  const id = formData.get("id") as string;
  if (id === admin.id) return { error: "Cannot delete yourself" };

  const user = await db.user.findUnique({ where: { id } });
  if (!user) return { error: "User not found" };

  await db.user.delete({ where: { id } });
  await logActivity("deleted", "user", id, admin.id, user.name);
  revalidateUser(id, { managerId: user.managerId });
  return { success: true };
}

export async function resetUserPassword(_prev: unknown, formData: FormData) {
  const admin = await requireAuth();
  // Restricted to ADMIN — managers can edit profile fields but not reset
  // login credentials for other users.
  if (admin.role !== "ADMIN") throw new Error("Admin access required");

  const id = formData.get("id") as string;
  const newPassword = (formData.get("newPassword") as string)?.trim() ?? "";
  if (!id) return { error: "Missing user" };
  if (newPassword.length < 8) return { error: "Password must be at least 8 characters" };

  const user = await db.user.findUnique({
    where: { id },
    select: { id: true, name: true, authProvider: true, hasLoginAccess: true },
  });
  if (!user) return { error: "User not found" };
  if (user.authProvider !== "credentials")
    return { error: "Cannot reset password for SSO accounts" };
  if (!user.hasLoginAccess)
    return { error: "User has no login access" };

  const hashedPassword = await hash(newPassword, 12);
  await db.user.update({ where: { id }, data: { hashedPassword } });
  await logActivity("reset password for", "user", id, admin.id, user.name);
  return { success: true };
}

export async function toggleUserActive(_prev: unknown, formData: FormData) {
  const admin = await requireAuth();
  requireAdminOrManager(admin.role);

  const id = formData.get("id") as string;
  const user = await db.user.findUnique({ where: { id } });
  if (!user) return { error: "Not found" };

  await db.user.update({
    where: { id },
    data: { isActive: !user.isActive },
  });

  revalidateUser(id, { managerId: user.managerId });
  return { success: true };
}

// Module Permissions
export async function saveModulePermissions(_prev: unknown, formData: FormData) {
  const admin = await requireAuth();
  requireAdminOrManager(admin.role);

  const userId = formData.get("userId") as string;

  // Iterate the module registry instead of hardcoding the list — adding a new
  // permissioned module in src/lib/modules.ts makes it automatically appear
  // in this save path with no changes here.
  const permissionedModules = getPermissionedModules();

  // Collect all module keys from the form — includes both registry modules
  // and dynamic custom-page-{id} keys from the permissions grid.
  const allKeys: string[] = permissionedModules.map((m) => m.key);

  // Detect custom page keys in the form submission (the permissions UI adds
  // checkboxes named `custom-page-{id}_canView`, etc.)
  const formEntries = Array.from(formData.keys());
  for (const key of formEntries) {
    const match = key.match(/^(custom-page-[^_]+)_/);
    if (match && !allKeys.includes(match[1])) {
      allKeys.push(match[1]);
    }
  }

  for (const modKey of allKeys) {
    const data: Record<string, boolean> = {};
    for (const flag of ALL_PERMISSION_FLAGS) {
      data[flag] = formData.get(`${modKey}_${flag}`) === "true";
    }

    await db.modulePermission.upsert({
      where: { userId_module: { userId, module: modKey } },
      create: { userId, module: modKey, ...data },
      update: data,
    });
  }

  revalidateUser(userId);
  return { success: true };
}

// Entity Permissions
export async function saveEntityPermission(_prev: unknown, formData: FormData) {
  const admin = await requireAuth();
  requireAdminOrManager(admin.role);

  const userId = formData.get("userId") as string;
  const entityType = formData.get("entityType") as string;
  const entityId = formData.get("entityId") as string;

  await db.entityPermission.upsert({
    where: { userId_entityType_entityId: { userId, entityType, entityId } },
    create: {
      userId,
      entityType,
      entityId,
      canView: formData.get("canView") === "true",
      canEdit: formData.get("canEdit") === "true",
      canComment: formData.get("canComment") === "true",
      canUpload: formData.get("canUpload") === "true",
      canManage: formData.get("canManage") === "true",
    },
    update: {
      canView: formData.get("canView") === "true",
      canEdit: formData.get("canEdit") === "true",
      canComment: formData.get("canComment") === "true",
      canUpload: formData.get("canUpload") === "true",
      canManage: formData.get("canManage") === "true",
    },
  });

  revalidateUser(userId);
  return { success: true };
}

export async function deleteEntityPermission(_prev: unknown, formData: FormData) {
  const admin = await requireAuth();
  requireAdminOrManager(admin.role);

  const id = formData.get("id") as string;
  const perm = await db.entityPermission.findUnique({ where: { id }, select: { userId: true } });
  await db.entityPermission.delete({ where: { id } });
  if (perm?.userId) revalidateUser(perm.userId);
  return { success: true };
}
