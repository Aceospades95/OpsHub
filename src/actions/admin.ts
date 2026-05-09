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
import { nameField } from "@/lib/validation";
import { issueSignupToken, INVITE_TOKEN_TTL_MS, consumeSignupToken } from "@/lib/signup-tokens";

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
  name: nameField({ label: "Name", min: 2 }),
  email: z.string().email("Invalid email").optional(),
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

  // For login users, email is required. Password is no longer accepted
  // here — the user sets their own via /signup/[token] after we send
  // them the invite. See src/lib/signup-tokens.ts for the rationale.
  if (hasLogin && !emailRaw) return { error: "Email is required for users with login access" };

  const parsed = createUserSchema.safeParse({
    name: formData.get("name"),
    email: emailRaw || undefined,
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
  // duplicate same-name rows in the Employees table. Block silent
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

  // No password is stored on create. For login users we mint a
  // SignupToken (consumed via /signup/[token]) and email them an
  // invite. Until they consume it, hashedPassword stays null and
  // they can't sign in via credentials. For no-login users we leave
  // hashedPassword null too; they have hasLoginAccess=false so the
  // credentials provider rejects them either way.
  const { email: _email, ...rest } = parsed.data;

  const user = await db.user.create({
    data: { ...rest, email, hashedPassword: null, hasLoginAccess: hasLogin },
  });

  await logActivity("created", "user", user.id, admin.id, user.name);
  revalidateUser(user.id, { managerId: user.managerId });

  /** Set when an invite is generated, so the UI can surface the URL
   *  as a fallback when email delivery is unverified or disabled. */
  let inviteUrl: string | null = null;

  // Invite flow — for login users with a real email, mint a one-time
  // signup token and (optionally) email it. The form's
  // `sendWelcomeEmail` toggle now controls whether the invite email
  // goes out; if off, the action still mints the token and returns
  // the URL so the admin can hand it off out-of-band (Slack DM,
  // pasted into a separate password manager, etc).
  //
  // No-login users (tracked-only employees) skip the token entirely
  // — their email column is a synthetic placeholder.
  if (hasLogin && parsed.data.email) {
    let shouldSendInvite = false;
    const fieldValue = formData.get("sendWelcomeEmail");
    if (fieldValue === "true") shouldSendInvite = true;
    else if (fieldValue === "false") shouldSendInvite = false;
    else {
      shouldSendInvite = await getBooleanAdminSetting(
        ADMIN_SETTING_KEYS.sendWelcomeEmailDefault,
        true
      );
    }

    try {
      const issued = await issueSignupToken(user.id, "invite");
      const fullUrl = absoluteUrl(issued.signupPath);
      inviteUrl = fullUrl;

      if (shouldSendInvite) {
        try {
          await sendFromTemplate(
            "invite",
            {
              name: user.name,
              signupUrl: fullUrl,
              expiresInHours: Math.round(INVITE_TOKEN_TTL_MS / (60 * 60 * 1000)),
              kind: "invite",
              invitedByName: admin.name || undefined,
            },
            {
              to: user.email,
              entityType: "user",
              entityId: user.id,
            }
          );
        } catch (err) {
          // Don't fail user creation if the invite email errors out —
          // the URL is also surfaced inline so the admin can deliver
          // it manually. The failure is logged in EmailLog.
          log.error("admin.user.inviteEmail", "Invite email failed", err);
        }
      }
    } catch (err) {
      log.error("admin.user.invite", "Invite token generation failed", err);
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

  // Return the invite URL when one was issued so the admin can copy
  // it from the form (handy when email delivery is disabled, the
  // recipient prefers a different channel, or the invite bounces).
  return { success: true, inviteUrl };
}

/**
 * Re-issue an invite / password-reset link for an existing user.
 *
 * Used by:
 *   - the admin Users page "Resend invite / reset password" action
 *     (which replaces the legacy resetUserPassword form that took a
 *     plaintext password from the admin)
 *   - the merge-employees flow when the keeper still has a null
 *     hashedPassword after consolidation
 *
 * Returns the URL even when the email send is skipped so the admin
 * can deliver it out-of-band.
 */
export async function sendUserInvite(
  _prev: unknown,
  formData: FormData
): Promise<{
  success?: boolean;
  error?: string;
  inviteUrl?: string | null;
}> {
  const admin = await requireAuth();
  if (admin.role !== "ADMIN") {
    return { error: "Admin access required" };
  }

  const id = formData.get("id") as string;
  const sendEmail = formData.get("sendEmail") !== "false";
  if (!id) return { error: "Missing user" };

  const user = await db.user.findUnique({ where: { id } });
  if (!user) return { error: "User not found" };
  if (!user.hasLoginAccess) {
    return {
      error: "This employee doesn't have login access. Toggle hasLoginAccess on first.",
    };
  }
  if (
    !user.email ||
    user.email.endsWith("@internal.local") ||
    !user.email.includes("@")
  ) {
    return {
      error:
        "User has a placeholder email. Edit the email first, then resend the invite.",
    };
  }

  // "reset" if the user already has a working password; "invite"
  // otherwise. The flows are identical — only the email copy differs.
  const kind = user.hashedPassword ? "reset" : "invite";

  try {
    const issued = await issueSignupToken(id, kind);
    const fullUrl = absoluteUrl(issued.signupPath);

    if (sendEmail) {
      try {
        await sendFromTemplate(
          "invite",
          {
            name: user.name,
            signupUrl: fullUrl,
            expiresInHours: Math.round(INVITE_TOKEN_TTL_MS / (60 * 60 * 1000)),
            kind,
            invitedByName: admin.name || undefined,
          },
          {
            to: user.email,
            entityType: "user",
            entityId: user.id,
          }
        );
      } catch (err) {
        log.error("admin.user.resendInvite.email", "Email failed", err);
      }
    }

    await logActivity(
      kind === "reset" ? "reset-link-sent" : "invite-resent",
      "user",
      user.id,
      admin.id,
      user.name
    );

    return { success: true, inviteUrl: fullUrl };
  } catch (err) {
    log.error("admin.user.resendInvite", "Token generation failed", err);
    return { error: "Could not generate invite token. Check server logs." };
  }
}

/**
 * Server action backing the public /signup/[token] page. Validates
 * the token + sets the user's password atomically. Returns the email
 * the user should sign in with so the page can pre-fill the login
 * form on success.
 */
export async function setPasswordFromToken(
  _prev: unknown,
  formData: FormData
): Promise<
  | { success: true; email: string }
  | { success?: false; error: string; reason?: string }
> {
  const token = (formData.get("token") as string)?.trim() ?? "";
  const password = (formData.get("password") as string) ?? "";
  const confirm = (formData.get("confirm") as string) ?? "";

  if (!token) return { error: "Missing token" };
  if (password.length < 8) {
    return { error: "Password must be at least 8 characters", reason: "weak" };
  }
  if (password !== confirm) {
    return { error: "Passwords don't match", reason: "mismatch" };
  }

  const result = await consumeSignupToken(token, password);
  if (!result.ok) {
    const messages: Record<string, string> = {
      missing: "This link isn't valid. Ask an admin to send a new one.",
      expired: "This link has expired. Ask an admin to send a new one.",
      used: "This link has already been used. Try signing in or ask for a new one.",
      weak: "Password must be at least 8 characters",
    };
    return {
      error: messages[result.reason] ?? "Could not set password",
      reason: result.reason,
    };
  }

  return { success: true, email: result.userEmail };
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
