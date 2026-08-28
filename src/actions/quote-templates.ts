"use server";

import { db } from "@/lib/db";
import { requireAuth, resolveModulePerms } from "@/lib/permissions";
import { logActivity } from "@/lib/activity";
import { revalidatePath } from "next/cache";
import { z } from "zod";

const templateMetaSchema = z.object({
  name: z.string().min(1, "Name is required"),
  description: z.string().optional().nullable(),
  introText: z.string().optional().nullable(),
  assumptionsText: z.string().optional().nullable(),
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
    assumptionsText: formData.get("assumptionsText") || undefined,
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
      assumptionsText: normalizeOptional(parsed.data.assumptionsText ?? null),
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
    assumptionsText: formData.get("assumptionsText") || undefined,
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
      assumptionsText: normalizeOptional(parsed.data.assumptionsText ?? null),
      termsText: normalizeOptional(parsed.data.termsText ?? null),
    },
  });
  revalidatePath("/quotes/templates");
  revalidatePath(`/quotes/templates/${id}`);
  return { success: true };
}

/** Max length for a variant label ("Gold", "Public sector", …). */
const VARIANT_LABEL_MAX = 40;

/**
 * Clone an existing template — fields plus ALL line items — into a new
 * named variant ("Gold", "Silver") grouped under its BASE template.
 *
 * Cloning a template that is itself a variant flattens: the new variant
 * attaches to the source's base, so the tree never nests deeper than one
 * level. Labels are unique-ish per base (case-insensitive check; no DB
 * constraint, so a race can slip through — acceptable for a picker
 * grouping aid).
 */
export async function createTemplateVariant(templateId: string, label: string) {
  const user = await requireAuth();
  const perms = await resolveModulePerms(user.id, user.role, "quotes");
  if (!perms.canCreate) return { error: "Permission denied" };

  if (!templateId) return { error: "Template id is required" };
  const trimmed = (label ?? "").trim();
  if (!trimmed) return { error: "Variant label is required" };
  if (trimmed.length > VARIANT_LABEL_MAX) {
    return { error: `Variant label must be at most ${VARIANT_LABEL_MAX} characters` };
  }

  const source = await db.quoteTemplate.findUnique({
    where: { id: templateId },
    include: {
      lineItems: { orderBy: { position: "asc" } },
      variantOf: { select: { id: true, name: true } },
    },
  });
  if (!source) return { error: "Template not found" };

  // Flatten variant-of-a-variant to the source's base — always one level.
  const base = source.variantOf ?? { id: source.id, name: source.name };

  const duplicate = await db.quoteTemplate.findFirst({
    where: {
      variantOfId: base.id,
      variantLabel: { equals: trimmed, mode: "insensitive" },
    },
    select: { id: true },
  });
  if (duplicate) {
    return { error: `A "${trimmed}" variant of this template already exists` };
  }

  const tpl = await db.quoteTemplate.create({
    data: {
      // "Base — Label" so quotes created from the variant (and .docx
      // exports) carry the tier without any change to those flows.
      name: `${base.name} — ${trimmed}`,
      description: source.description,
      introText: source.introText,
      assumptionsText: source.assumptionsText,
      termsText: source.termsText,
      variantOfId: base.id,
      variantLabel: trimmed,
      createdById: user.id,
      lineItems: {
        create: source.lineItems.map((li, i) => ({
          position: i,
          groupLabel: li.groupLabel,
          isOptional: li.isOptional,
          catalogItemId: li.catalogItemId,
          name: li.name,
          description: li.description,
          quantity: li.quantity,
          unit: li.unit,
          unitPrice: li.unitPrice,
          discountType: li.discountType,
          discountValue: li.discountValue,
          isRecurring: li.isRecurring,
          recurringInterval: li.recurringInterval,
        })),
      },
    },
  });

  await logActivity("created", "quote-template", tpl.id, user.id, tpl.name);
  revalidatePath("/quotes/templates");
  return { success: true, id: tpl.id };
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
