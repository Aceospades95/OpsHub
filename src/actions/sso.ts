"use server";

import { db } from "@/lib/db";
import { requireAuth } from "@/lib/permissions";
import { revalidatePath } from "next/cache";
import { z } from "zod";

function requireAdmin(role: string) {
  if (role !== "ADMIN") throw new Error("Admin access required");
}

const domainSchema = z
  .string()
  .min(1, "Domain is required")
  .regex(
    /^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)*\.[a-zA-Z]{2,}$/,
    "Invalid domain format (e.g. company.com)"
  );

export async function addAllowedDomain(_prev: unknown, formData: FormData) {
  const user = await requireAuth();
  requireAdmin(user.role);

  const raw = (formData.get("domain") as string)?.trim().toLowerCase();
  const parsed = domainSchema.safeParse(raw);

  if (!parsed.success) {
    return { error: parsed.error.errors[0].message };
  }

  const domain = parsed.data;

  const existing = await db.allowedDomain.findUnique({ where: { domain } });
  if (existing) {
    return { error: "This domain is already in the allowlist" };
  }

  await db.allowedDomain.create({ data: { domain } });
  revalidatePath("/admin/sso");
  return { success: true };
}

export async function removeAllowedDomain(id: string) {
  const user = await requireAuth();
  requireAdmin(user.role);

  await db.allowedDomain.delete({ where: { id } });
  revalidatePath("/admin/sso");
}

export async function getAllowedDomains() {
  const user = await requireAuth();
  requireAdmin(user.role);

  return db.allowedDomain.findMany({ orderBy: { createdAt: "asc" } });
}
