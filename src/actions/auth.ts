"use server";

import { signIn } from "@/lib/auth";
import { db } from "@/lib/db";
import { hash } from "bcryptjs";
import { z } from "zod";
import { AuthError } from "next-auth";
import { revalidatePath } from "next/cache";
import { requireAuth } from "@/lib/permissions";
import { logActivity } from "@/lib/activity";

const loginSchema = z.object({
  email: z.string().email("Invalid email"),
  password: z.string().min(1, "Password is required"),
});

const registerSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters"),
  email: z.string().email("Invalid email"),
  password: z.string().min(6, "Password must be at least 6 characters"),
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

export async function registerAction(_prev: unknown, formData: FormData) {
  const parsed = registerSchema.safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    return { error: "Invalid input", fieldErrors: parsed.error.flatten().fieldErrors };
  }

  const existing = await db.user.findUnique({
    where: { email: parsed.data.email },
  });

  if (existing) {
    return { error: "Email already registered" };
  }

  const hashedPassword = await hash(parsed.data.password, 12);

  await db.user.create({
    data: {
      name: parsed.data.name,
      email: parsed.data.email,
      hashedPassword,
      role: "VIEWER",
    },
  });

  try {
    await signIn("credentials", {
      email: parsed.data.email,
      password: parsed.data.password,
      redirect: false,
    });
    return { success: true };
  } catch (error) {
    if (error instanceof AuthError) {
      return { success: true }; // registered but auto-login failed, still success
    }
    throw error;
  }
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
    select: { id: true, name: true, email: true },
  });
  if (!target) return { error: "User not found" } as const;

  const result = await db.account.deleteMany({
    where: { userId, provider: "google" },
  });

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
