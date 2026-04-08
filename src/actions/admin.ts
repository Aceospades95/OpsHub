"use server";

import { db } from "@/lib/db";
import { requireAuth } from "@/lib/permissions";
import { logActivity } from "@/lib/activity";
import { revalidatePath } from "next/cache";
import { hash } from "bcryptjs";
import { z } from "zod";

function requireAdminOrManager(role: string) {
  if (role !== "ADMIN" && role !== "MANAGER") throw new Error("Admin or Manager access required");
}

const createUserSchema = z.object({
  name: z.string().min(2, "Name required"),
  email: z.string().email("Invalid email").optional(),
  password: z.string().min(6, "Min 6 chars").optional(),
  role: z.enum(["ADMIN", "MANAGER", "DEVELOPER", "CONTRIBUTOR", "VIEWER"]),
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
  const emailRaw = (formData.get("email") as string)?.trim();
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
  revalidatePath("/admin/users");
  revalidatePath("/team");
  return { success: true };
}

const updateUserSchema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  role: z.enum(["ADMIN", "MANAGER", "DEVELOPER", "CONTRIBUTOR", "VIEWER"]),
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

  const parsed = updateUserSchema.safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
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

  // Use null instead of undefined to actually clear the field
  await db.user.update({
    where: { id },
    data: { ...parsed.data, managerId: managerId },
  });
  await logActivity("updated", "user", id, admin.id, parsed.data.name);
  revalidatePath(`/admin/users/${id}`);
  revalidatePath("/admin/users");
  revalidatePath("/team");
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
  revalidatePath("/admin/users");
  revalidatePath("/team");
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

  revalidatePath("/admin/users");
  revalidatePath("/team");
  return { success: true };
}

// Module Permissions
export async function saveModulePermissions(_prev: unknown, formData: FormData) {
  const admin = await requireAuth();
  requireAdminOrManager(admin.role);

  const userId = formData.get("userId") as string;
  const modules = ["clients", "projects", "contracts", "suppliers", "tools", "intranet", "admin"];
  const flags = ["canView", "canEdit", "canCreate", "canDelete", "canComment", "canUpload", "canManage"];

  for (const mod of modules) {
    const data: Record<string, boolean> = {};
    for (const flag of flags) {
      data[flag] = formData.get(`${mod}_${flag}`) === "true";
    }

    await db.modulePermission.upsert({
      where: { userId_module: { userId, module: mod } },
      create: { userId, module: mod, ...data },
      update: data,
    });
  }

  revalidatePath(`/admin/users/${userId}`);
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

  revalidatePath(`/admin/users/${userId}`);
  return { success: true };
}

export async function deleteEntityPermission(_prev: unknown, formData: FormData) {
  const admin = await requireAuth();
  requireAdminOrManager(admin.role);

  const id = formData.get("id") as string;
  await db.entityPermission.delete({ where: { id } });
  revalidatePath("/admin/users");
  revalidatePath("/team");
  return { success: true };
}
