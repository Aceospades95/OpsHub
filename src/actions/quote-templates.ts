"use server";

import { db } from "@/lib/db";
import { requireAuth, resolveModulePerms } from "@/lib/permissions";
import { revalidatePath } from "next/cache";
import { z } from "zod";

const templateMetaSchema = z.object({
  name: z.string().min(1, "Name is required"),
  description: z.string().optional().nullable(),
  introText: z.string().optional().nullable(),
  termsText: z.string().optional().nullable(),
});

function normalizeOptional(v: string | null | undefined): string | null {
  if (v == null) return null;
  const t = String(v).trim();
  return t.length === 0 ? null : t;
}

export async function createQuoteTemplate(_prev: unknown, formData: FormData) {
  const user = await requireAuth();
  const perms = await resolveModulePerms(user.id, user.role, "quotes");
  if (!perms.canCreate) return { error: "Permission denied" };

  const parsed = templateMetaSchema.safeParse({
    name: formData.get("name"),
    description: formData.get("description") || undefined,
    introText: formData.get("introText") || undefined,
    termsText: formData.get("termsText") || undefined,
  });
  if (!parsed.success) {
    return { error: "Invalid input", fieldErrors: parsed.error.flatten().fieldErrors };
  }

  const tpl = await db.quoteTemplate.create({
    data: {
      name: parsed.data.name,
      description: normalizeOptional(parsed.data.description ?? null),
      introText: normalizeOptional(parsed.data.introText ?? null),
      termsText: normalizeOptional(parsed.data.termsText ?? null),
      createdById: user.id,
    },
  });
  revalidatePath("/quotes/templates");
  return { success: true, id: tpl.id };
}

export async function updateQuoteTemplateMeta(_prev: unknown, formData: FormData) {
  const user = await requireAuth();
  const perms = await resolveModulePerms(user.id, user.role, "quotes");
  if (!perms.canEdit) return { error: "Permission denied" };

  const id = formData.get("id") as string;
  if (!id) return { error: "Template id is required" };

  const parsed = templateMetaSchema.safeParse({
    name: formData.get("name"),
    description: formData.get("description") || undefined,
    introText: formData.get("introText") || undefined,
    termsText: formData.get("termsText") || undefined,
  });
  if (!parsed.success) {
    return { error: "Invalid input", fieldErrors: parsed.error.flatten().fieldErrors };
  }

  await db.quoteTemplate.update({
    where: { id },
    data: {
      name: parsed.data.name,
      description: normalizeOptional(parsed.data.description ?? null),
      introText: normalizeOptional(parsed.data.introText ?? null),
      termsText: normalizeOptional(parsed.data.termsText ?? null),
    },
  });
  revalidatePath("/quotes/templates");
  revalidatePath(`/quotes/templates/${id}`);
  return { success: true };
}

export async function deleteQuoteTemplate(_prev: unknown, formData: FormData) {
  const user = await requireAuth();
  const perms = await resolveModulePerms(user.id, user.role, "quotes");
  if (!perms.canDelete) return { error: "Permission denied" };

  const id = formData.get("id") as string;
  if (!id) return { error: "Template id is required" };

  await db.quoteTemplate.delete({ where: { id } });
  revalidatePath("/quotes/templates");
  return { success: true };
}
