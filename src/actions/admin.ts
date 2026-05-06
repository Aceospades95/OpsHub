"use server";

import { db } from "@/lib/db";
import { log } from "@/lib/log";
import { requireAuth } from "@/lib/permissions";
import { logActivity } from "@/lib/activity";
import {
  ADMIN_SETTING_KEYS,
  getBooleanAdminSetting,
} from "@/lib/admin-settings";
import { revalidatePath } from "next/cache";
import { revalidateUser } from "@/lib/revalidate-entity";
import { getPermissionedModules, ALL_PERMISSION_FLAGS } from "@/lib/modules";
import { sendFromTemplate } from "@/lib/email";
import { absoluteUrl } from "@/lib/url";
import { hash } from "bcryptjs";
import { z } from "zod";

function requireAdminOrManager(role: string): { error: string } | null {
  if (role !== "ADMIN" && role !== "MANAGER") {
    return { error: "Admin or Manager access required" };
  }
  return null;
}

/**
 * Restricts an action to ADMIN role only. Used for edits to the
 * permissions matrix itself — letting a MANAGER call those would
 * be a privilege-escalation surface (self-grant `canManage:true` on
 * every module, or hand the same to anyone). Returns a structured
 * error rather than throwing so the action wrapper can surface it
 * inline instead of crashing to a Next.js 500.
 */
function requireAdmin(role: string): { error: string } | null {
  if (role !== "ADMIN") {
    return { error: "Admin access required" };
  }
  return null;
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
  const gate = requireAdminOrManager(admin.role);
  if (gate) return gate;

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

  // Same-name duplicate guard. Two of the QA stress-test bugs traced
  // back to a previous import / seed creating a synthetic-email
  // placeholder for someone who already had a real account, leaving
  // two "Jacob Wright" rows in the Employees table. Block silent
  // recurrences: if any active user already has this name (case-
  // insensitive), require the admin to confirm explicitly. The Add
  // Employee dialog re-submits with confirmDuplicateName=true after
  // the operator clicks through the warning.
  const confirmDuplicate =
    formData.get("confirmDuplicateName") === "true";
  if (!confirmDuplicate) {
    const namedClash = await db.user.findFirst({
      where: {
        name: { equals: parsed.data.name, mode: "insensitive" },
        isActive: true,
      },
      select: { id: true, name: true, email: true, jobTitle: true, department: true },
    });
    if (namedClash) {
      return {
        error: `An active employee named "${namedClash.name}" already exists${
          namedClash.jobTitle ? ` (${namedClash.jobTitle})` : ""
        }. Confirm to create a second one.`,
        duplicateName: {
          id: namedClash.id,
          name: namedClash.name,
          email: namedClash.email,
          jobTitle: namedClash.jobTitle,
          department: namedClash.department,
        },
      };
    }
  }

  const hashedPassword = parsed.data.password
    ? await hash(parsed.data.password, 12)
    : await hash(`noaccess-${Date.now()}`, 12);

  const { password: _pw, email: _email, ...rest } = parsed.data;

  const user = await db.user.create({
    data: { ...rest, email, hashedPassword, hasLoginAccess: hasLogin },
  });

  await logActivity("created", "user", user.id, admin.id, user.name);
  revalidateUser(user.id, { managerId: user.managerId });

  // Welcome email — opt-out per-user via the create-user dialog, with
  // a configurable org-wide default at /admin/settings. Originally this
  // fired unconditionally on every login-enabled user create, which
  // surprised admins who'd archived their welcome workflow expecting
  // the email to stop. The send is now driven by an explicit form
  // field with the org default as fallback so the action is always
  // visible to whoever's creating the user.
  //
  // The send is skipped for no-login placeholder users (tracked-only
  // employees) since their email column is a fake placeholder.
  let shouldSendWelcome = false;
  if (hasLogin && parsed.data.email) {
    const fieldValue = formData.get("sendWelcomeEmail");
    if (fieldValue === "true") shouldSendWelcome = true;
    else if (fieldValue === "false") shouldSendWelcome = false;
    else {
      // No field at all (legacy client / script POST) — fall back to
      // the org-wide default so existing automation keeps working.
      shouldSendWelcome = await getBooleanAdminSetting(
        ADMIN_SETTING_KEYS.sendWelcomeEmailDefault,
        true
      );
    }
  }
  if (shouldSendWelcome) {
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
      log.error("admin.user.welcomeEmail", "Welcome email failed", err);
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
    log.error("admin.user.triggers", "Workflow auto-trigger failed", err);
  }

  // Manually-selected workflow templates from the create dialog. The
  // form posts a comma-separated list of template ids in
  // `workflowTemplateIds` so we don't need a multi-FormData parser.
  // Auto-trigger templates above + manual selections here may overlap;
  // we de-duplicate to avoid double-spawning the same template.
  const manualTemplateIdsRaw = formData.get("workflowTemplateIds");
  if (typeof manualTemplateIdsRaw === "string" && manualTemplateIdsRaw.trim().length > 0) {
    const ids = manualTemplateIdsRaw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (ids.length > 0) {
      try {
        const { createInstance } = await import("@/lib/workflows/engine");
        for (const templateId of ids) {
          // Skip templates that already auto-fired against this user —
          // re-spawn would create a duplicate instance for the same
          // subject + template.
          const existing = await db.workflowInstance.findFirst({
            where: {
              workflowTemplateId: templateId,
              subjectType: "EMPLOYEE",
              subjectId: user.id,
              status: { in: ["PENDING", "IN_PROGRESS", "PAUSED", "COMPLETED"] },
            },
            select: { id: true },
          });
          if (existing) continue;
          await createInstance({
            templateId,
            subjectType: "EMPLOYEE",
            subjectId: user.id,
            createdById: admin.id,
            autoStart: true,
          });
        }
      } catch (err) {
        log.error("admin.user.manualWorkflow", "Manual workflow start failed", err);
      }
    }
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
  const gate = requireAdminOrManager(admin.role);
  if (gate) return gate;

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
  const gate = requireAdminOrManager(admin.role);
  if (gate) return gate;

  const id = formData.get("id") as string;
  if (id === admin.id) return { error: "Cannot delete yourself" };

  const user = await db.user.findUnique({ where: { id } });
  if (!user) return { error: "User not found" };

  // Hard delete fails when the user is referenced by a record we don't
  // cascade-delete from (Comment.author, ActivityLog.user, SandboxPage
  // .createdBy, CustomWidget.createdBy, plus countless audit references).
  // Surface a clean message so the admin can deactivate instead of
  // hard-deleting, rather than crashing to a 500 page with a Prisma
  // "Foreign key constraint failed" stack.
  try {
    await db.user.delete({ where: { id } });
  } catch (err) {
    // Prisma marks FK violations with code P2003. Anything else
    // bubbles as a real failure since we can't translate it.
    if (
      err &&
      typeof err === "object" &&
      "code" in err &&
      (err as { code: string }).code === "P2003"
    ) {
      return {
        error:
          "This user has comments, activity history, or other authored records that block deletion. Deactivate the user instead (toggle 'Has login access' off and set inactive) — that preserves history while disabling sign-in.",
      };
    }
    log.error("admin.user.delete", "deleteUser failed", err);
    return {
      error: "Could not delete user. Check server logs for details.",
    };
  }
  await logActivity("deleted", "user", id, admin.id, user.name);
  revalidateUser(id, { managerId: user.managerId, deleted: true });
  return { success: true };
}

export async function resetUserPassword(_prev: unknown, formData: FormData) {
  const admin = await requireAuth();
  // Restricted to ADMIN — managers can edit profile fields but not reset
  // login credentials for other users.
  if (admin.role !== "ADMIN") return { error: "Admin access required" };

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
  const gate = requireAdminOrManager(admin.role);
  if (gate) return gate;

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

// Module Permissions — ADMIN ONLY. Letting a MANAGER call this would
// let them self-grant canManage on every module (effectively a private
// admin promotion).
export async function saveModulePermissions(_prev: unknown, formData: FormData) {
  const admin = await requireAuth();
  const gate = requireAdmin(admin.role);
  if (gate) return gate;

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

// Entity Permissions — ADMIN ONLY for the same reason as
// saveModulePermissions: lets the actor grant canManage on any
// specific project/client/etc.
export async function saveEntityPermission(_prev: unknown, formData: FormData) {
  const admin = await requireAuth();
  const gate = requireAdmin(admin.role);
  if (gate) return gate;

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

// ADMIN ONLY — same reasoning as the save actions above; revoking a
// permission row is editing the permissions matrix.
export async function deleteEntityPermission(_prev: unknown, formData: FormData) {
  const admin = await requireAuth();
  const gate = requireAdmin(admin.role);
  if (gate) return gate;

  const id = formData.get("id") as string;
  const perm = await db.entityPermission.findUnique({ where: { id }, select: { userId: true } });
  await db.entityPermission.delete({ where: { id } });
  if (perm?.userId) revalidateUser(perm.userId);
  return { success: true };
}
