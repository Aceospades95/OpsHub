"use server";

import { db } from "@/lib/db";
import { requireAuth } from "@/lib/permissions";
import { logActivity } from "@/lib/activity";
import { revalidatePath } from "next/cache";
import { hash } from "bcryptjs";
import { z } from "zod";

function requireAdmin(role: string) {
  if (role !== "ADMIN") throw new Error("Admin access required");
}

const createUserSchema = z.object({
  name: z.string().min(2, "Name required"),
  email: z.string().email("Invalid email"),
  password: z.string().min(6, "Min 6 chars"),
  role: z.enum(["ADMIN", "MANAGER", "CONTRIBUTOR", "VIEWER"]),
  department: z.string().optional(),
  jobTitle: z.string().optional(),
  phone: z.string().optional(),
  managerId: z.string().optional(),
});

export async function createUser(_prev: unknown, formData: FormData) {
  const admin = await requireAuth();
  requireAdmin(admin.role);

  const parsed = createUserSchema.safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
    password: formData.get("password"),
    role: formData.get("role") || "VIEWER",
    department: formData.get("department") || undefined,
    jobTitle: formData.get("jobTitle") || undefined,
    phone: formData.get("phone") || undefined,
    managerId: formData.get("managerId") || undefined,
  });

  if (!parsed.success) return { error: "Invalid input", fieldErrors: parsed.error.flatten().fieldErrors };

  const existing = await db.user.findUnique({ where: { email: parsed.data.email } });
  if (existing) return { error: "Email already exists" };

  const hashedPassword = await hash(parsed.data.password, 12);
  const { password, ...rest } = parsed.data;

  const user = await db.user.create({
    data: { ...rest, hashedPassword },
  });

  await logActivity("created", "user", user.id, admin.id, user.name);
  revalidatePath("/admin/users");
  return { success: true };
}

const updateUserSchema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  role: z.enum(["ADMIN", "MANAGER", "CONTRIBUTOR", "VIEWER"]),
  department: z.string().optional(),
  jobTitle: z.string().optional(),
  phone: z.string().optional(),
  managerId: z.string().optional(),
  isActive: z.boolean().optional(),
});

export async function updateUser(_prev: unknown, formData: FormData) {
  const admin = await requireAuth();
  requireAdmin(admin.role);

  const id = formData.get("id") as string;
  const parsed = updateUserSchema.safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
    role: formData.get("role"),
    department: formData.get("department") || undefined,
    jobTitle: formData.get("jobTitle") || undefined,
    phone: formData.get("phone") || undefined,
    managerId: formData.get("managerId") || undefined,
    isActive: formData.get("isActive") !== "false",
  });

  if (!parsed.success) return { error: "Invalid input", fieldErrors: parsed.error.flatten().fieldErrors };

  await db.user.update({ where: { id }, data: parsed.data });
  await logActivity("updated", "user", id, admin.id, parsed.data.name);
  revalidatePath(`/admin/users/${id}`);
  revalidatePath("/admin/users");
  return { success: true };
}

export async function deleteUser(_prev: unknown, formData: FormData) {
  const admin = await requireAuth();
  requireAdmin(admin.role);

  const id = formData.get("id") as string;
  if (id === admin.id) return { error: "Cannot delete yourself" };

  const user = await db.user.findUnique({ where: { id } });
  if (!user) return { error: "User not found" };

  await db.user.delete({ where: { id } });
  await logActivity("deleted", "user", id, admin.id, user.name);
  revalidatePath("/admin/users");
  return { success: true };
}

export async function toggleUserActive(_prev: unknown, formData: FormData) {
  const admin = await requireAuth();
  requireAdmin(admin.role);

  const id = formData.get("id") as string;
  const user = await db.user.findUnique({ where: { id } });
  if (!user) return { error: "Not found" };

  await db.user.update({
    where: { id },
    data: { isActive: !user.isActive },
  });

  revalidatePath("/admin/users");
  return { success: true };
}

// Module Permissions
export async function saveModulePermissions(_prev: unknown, formData: FormData) {
  const admin = await requireAuth();
  requireAdmin(admin.role);

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
  requireAdmin(admin.role);

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
  requireAdmin(admin.role);

  const id = formData.get("id") as string;
  await db.entityPermission.delete({ where: { id } });
  revalidatePath("/admin/users");
  return { success: true };
}
