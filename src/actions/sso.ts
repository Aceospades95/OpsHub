"use server";

import { db } from "@/lib/db";
import { requireAuth } from "@/lib/permissions";
import { revalidatePath } from "next/cache";
import { z } from "zod";

function requireAdmin(role: string): { error: string } | null {
  if (role !== "ADMIN") return { error: "Admin access required" };
  return null;
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
  const gate = requireAdmin(user.role);
  if (gate) return gate;

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
  const gate = requireAdmin(user.role);
  if (gate) return gate;

  await db.allowedDomain.delete({ where: { id } });
  revalidatePath("/admin/sso");
}

export async function getAllowedDomains() {
  const user = await requireAuth();
  const gate = requireAdmin(user.role);
  if (gate) return gate;

  return db.allowedDomain.findMany({ orderBy: { createdAt: "asc" } });
}
