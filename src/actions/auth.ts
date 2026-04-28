"use server";

import { signIn } from "@/lib/auth";
import { db } from "@/lib/db";
import { z } from "zod";
import { AuthError } from "next-auth";
import { revalidatePath } from "next/cache";
import { requireAuth } from "@/lib/permissions";
import { logActivity } from "@/lib/activity";

const loginSchema = z.object({
  email: z.string().email("Invalid email"),
  password: z.string().min(1, "Password is required"),
});

export async function loginAction(_prev: unknown, formData: FormData) {
  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    return { error: "Invalid credentials", fieldErrors: parsed.error.flatten().fieldErrors };
  }

  try {
    await signIn("credentials", {
      email: parsed.data.email,
      password: parsed.data.password,
      redirect: false,
    });
    return { success: true };
  } catch (error) {
    if (error instanceof AuthError) {
      return { error: "Invalid email or password" };
    }
    throw error;
  }
}

/**
 * Self-registration is disabled.
 *
 * Open registration on a B2B internal tool is too dangerous: any
 * internet stranger could create an account, log in as VIEWER, and
 * see whatever VIEWER has scope on. The public `/register` page is
 * also unbounded by the AllowedDomain allowlist (which only gates
 * Google SSO), and the original implementation leaked email
 * existence ("Email already registered") — a credential-stuffing
 * oracle.
 *
 * Accounts are created by admins via /admin/users → "Add User".
 * If self-service registration is needed later, the right shape is
 * an admin-invited token flow + AllowedDomain check + admin
 * approval queue, not a public POST endpoint.
 *
 * The action stays in place (rather than being deleted) so any
 * lingering POSTs to /api/... receive a graceful, non-leaky reply.
 */
export async function registerAction(_prev: unknown, _formData: FormData) {
  return {
    error:
      "Self-registration is disabled. Contact an administrator to request access.",
  } as const;
}

/**
 * Force-unlink a user's Google Account row. The user is unaffected
 * apart from losing their SSO link — they re-link automatically on
 * the next Google sign-in (assuming `hasLoginAccess` is still true).
 *
 * Useful when:
 *   - An admin needs to reset a user whose Google identity has been
 *     compromised or rotated
 *   - The wrong identity got linked (rare, but recoverable)
 *   - As part of off-boarding before flipping `hasLoginAccess: false`
 */
export async function unlinkGoogleAccount(userId: string) {
  const admin = await requireAuth();
  if (admin.role !== "ADMIN") {
    return { error: "Admin access required" } as const;
  }

  const target = await db.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      hashedPassword: true,
      hasLoginAccess: true,
    },
  });
  if (!target) return { error: "User not found" } as const;

  // Refuse if unlinking would leave the user with no usable auth method.
  // Without hashedPassword the user has only Google to sign in with;
  // dropping the Account row leaves them locked out. Re-enable a
  // password (admin reset) before unlinking.
  if (!target.hashedPassword && target.hasLoginAccess) {
    return {
      error:
        "This user has no password set, so unlinking their Google account would lock them out. Set a password via Reset Password first, then try again.",
    } as const;
  }

  // Refuse if the target IS the only ADMIN with a working sign-in path
  // — guardrail against an admin accidentally locking the org out of
  // its own instance. We count active admins with EITHER a password
  // OR a linked Google account; subtract this target's Google account
  // (the thing we're about to delete) if they're an admin.
  if (target.role === "ADMIN") {
    const otherActiveAdmins = await db.user.count({
      where: {
        role: "ADMIN",
        isActive: true,
        hasLoginAccess: true,
        id: { not: target.id },
        OR: [
          { hashedPassword: { not: null } },
          { accounts: { some: { provider: "google" } } },
        ],
      },
    });
    const targetWillStillSignIn = !!target.hashedPassword;
    if (otherActiveAdmins === 0 && !targetWillStillSignIn) {
      return {
        error:
          "Refusing to unlink: this is the only admin with a working sign-in method. Add another admin (or set a password on this one) before unlinking.",
      } as const;
    }
  }

  const result = await db.account.deleteMany({
    where: { userId, provider: "google" },
  });

  if (result.count === 0) {
    return {
      error: "This user has no linked Google account.",
    } as const;
  }

  await logActivity(
    "unlinked-google",
    "user",
    target.id,
    admin.id,
    target.name
  );

  revalidatePath(`/team/${userId}`);
  revalidatePath("/admin/users");
  return { success: true, removed: result.count } as const;
}
