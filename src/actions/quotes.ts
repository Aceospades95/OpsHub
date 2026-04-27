"use server";

import { db } from "@/lib/db";
import { requireAuth, resolveModulePerms } from "@/lib/permissions";
import { logActivity } from "@/lib/activity";
import { revalidateQuote } from "@/lib/revalidate-entity";
import { computeQuoteTotals } from "@/lib/quotes/totals";
import { nextQuoteNumber } from "@/lib/quotes/numbering";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { Prisma, QuoteStatus } from "@prisma/client";

// ─── Validation ──────────────────────────────────────────────────────────

const discountTypeSchema = z.enum(["NONE", "PERCENT", "FIXED"]);
const recurringIntervalSchema = z.enum(["MONTHLY", "QUARTERLY", "ANNUALLY"]);

const lineItemSchema = z.object({
  /** Stable client-side id for re-ordering during a single edit session. */
  clientId: z.string().optional(),
  position: z.number().int().min(0),
  groupLabel: z.string().nullish(),
  isOptional: z.boolean().optional(),
  isSelected: z.boolean().optional(),
  catalogItemId: z.string().nullish(),
  name: z.string().min(1, "Line item name is required"),
  description: z.string().nullish(),
  quantity: z.number().min(0),
  unit: z.string().nullish(),
  unitPrice: z.number(),
  discountType: discountTypeSchema.optional(),
  discountValue: z.number().min(0).optional(),
  isRecurring: z.boolean().optional(),
  recurringInterval: recurringIntervalSchema.nullish(),
});

const quoteUpsertSchema = z.object({
  clientId: z.string().min(1, "Client is required"),
  projectId: z.string().nullish(),
  title: z.string().min(1, "Title is required"),
  introText: z.string().nullish(),
  termsText: z.string().nullish(),
  currency: z.string().min(1).default("USD"),
  discountType: discountTypeSchema.default("NONE"),
  discountValue: z.number().min(0).default(0),
  taxRate: z.number().min(0).nullish(),
  validUntil: z.string().nullish(), // ISO date string from <input type="date">
  assignedToId: z.string().nullish(),
  internalNotes: z.string().nullish(),
  lineItems: z.array(lineItemSchema).default([]),
});

export type QuoteUpsertInput = z.infer<typeof quoteUpsertSchema>;

// ─── Helpers ─────────────────────────────────────────────────────────────

function normalizeOptional<T extends string | null | undefined>(v: T): string | null {
  if (v == null) return null;
  const trimmed = String(v).trim();
  return trimmed.length === 0 ? null : trimmed;
}

function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d;
}

async function logQuoteEvent(
  quoteId: string,
  eventType: string,
  actorId: string,
  metadata?: Record<string, unknown>
) {
  await db.quoteEvent.create({
    data: {
      quoteId,
      eventType,
      actorType: "user",
      actorId,
      metadata: metadata ? JSON.stringify(metadata) : null,
    },
  });
}

async function persistQuoteWithItems(
  quoteId: string,
  data: QuoteUpsertInput,
  options: { skipLineItems?: boolean } = {}
) {
  const totals = computeQuoteTotals({
    lineItems: data.lineItems.map((li) => ({
      quantity: li.quantity,
      unitPrice: li.unitPrice,
      discountType: li.discountType ?? "NONE",
      discountValue: li.discountValue ?? 0,
      isOptional: li.isOptional ?? false,
      isSelected: li.isSelected ?? true,
    })),
    discountType: data.discountType,
    discountValue: data.discountValue,
    taxRate: data.taxRate ?? null,
  });

  const validUntil = parseDate(data.validUntil);

  await db.$transaction(async (tx) => {
    await tx.quote.update({
      where: { id: quoteId },
      data: {
        clientId: data.clientId,
        projectId: normalizeOptional(data.projectId) || null,
        title: data.title,
        introText: normalizeOptional(data.introText),
        termsText: normalizeOptional(data.termsText),
        currency: data.currency || "USD",
        discountType: data.discountType,
        discountValue: data.discountValue,
        taxRate: data.taxRate ?? null,
        taxAmount: totals.taxAmount,
        subtotal: totals.subtotal,
        total: totals.total,
        validUntil,
        assignedToId: normalizeOptional(data.assignedToId) || null,
        internalNotes: normalizeOptional(data.internalNotes),
      },
    });

    if (!options.skipLineItems) {
      await tx.quoteLineItem.deleteMany({ where: { quoteId } });
      if (data.lineItems.length > 0) {
        await tx.quoteLineItem.createMany({
          data: data.lineItems.map((li, i) => ({
            quoteId,
            position: li.position ?? i,
            groupLabel: normalizeOptional(li.groupLabel),
            isOptional: li.isOptional ?? false,
            isSelected: li.isSelected ?? true,
            catalogItemId: normalizeOptional(li.catalogItemId) || null,
            name: li.name,
            description: normalizeOptional(li.description),
            quantity: li.quantity,
            unit: normalizeOptional(li.unit),
            unitPrice: li.unitPrice,
            discountType: li.discountType ?? "NONE",
            discountValue: li.discountValue ?? 0,
            isRecurring: li.isRecurring ?? false,
            recurringInterval: li.recurringInterval ?? null,
            subtotal: totals.lineSubtotals[i]?.subtotal ?? 0,
          })),
        });
      }
    }
  });

  return totals;
}

// ─── Quote CRUD ──────────────────────────────────────────────────────────

export interface CreateQuoteOptions {
  fromTemplateId?: string;
  fromQuoteId?: string;
  clientId?: string;
  projectId?: string;
}

export async function createQuote(opts: CreateQuoteOptions = {}) {
  const user = await requireAuth();
  const perms = await resolveModulePerms(user.id, user.role, "quotes");
  if (!perms.canCreate) return { error: "Permission denied" } as const;

  // Resolve seed: empty, from template, or duplicated quote.
  let seedClientId: string | null = opts.clientId ?? null;
  let seedProjectId: string | null = opts.projectId ?? null;
  let seedTitle = "Untitled Quote";
  let seedIntro: string | null = null;
  let seedTerms: string | null = null;
  let seedCurrency = "USD";
  let seedDiscountType: "NONE" | "PERCENT" | "FIXED" = "NONE";
  let seedDiscountValue = 0;
  let seedTaxRate: number | null = null;
  type SeedItem = {
    position: number;
    groupLabel: string | null;
    isOptional: boolean;
    isSelected: boolean;
    catalogItemId: string | null;
    name: string;
    description: string | null;
    quantity: number;
    unit: string | null;
    unitPrice: number;
    discountType: "NONE" | "PERCENT" | "FIXED";
    discountValue: number;
    isRecurring: boolean;
    recurringInterval: "MONTHLY" | "QUARTERLY" | "ANNUALLY" | null;
  };
  let seedItems: SeedItem[] = [];

  if (opts.fromTemplateId) {
    const tpl = await db.quoteTemplate.findUnique({
      where: { id: opts.fromTemplateId },
      include: { lineItems: { orderBy: { position: "asc" } } },
    });
    if (!tpl) return { error: "Template not found" } as const;
    seedTitle = tpl.name;
    seedIntro = tpl.introText;
    seedTerms = tpl.termsText;
    seedItems = tpl.lineItems.map((li, i) => ({
      position: i,
      groupLabel: li.groupLabel,
      isOptional: li.isOptional,
      isSelected: true,
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
    }));
  } else if (opts.fromQuoteId) {
    const src = await db.quote.findUnique({
      where: { id: opts.fromQuoteId },
      include: { lineItems: { orderBy: { position: "asc" } } },
    });
    if (!src) return { error: "Source quote not found" } as const;
    seedClientId = src.clientId;
    seedProjectId = src.projectId;
    seedTitle = `Copy of ${src.title}`;
    seedIntro = src.introText;
    seedTerms = src.termsText;
    seedCurrency = src.currency;
    seedDiscountType = src.discountType;
    seedDiscountValue = src.discountValue;
    seedTaxRate = src.taxRate;
    seedItems = src.lineItems.map((li, i) => ({
      position: i,
      groupLabel: li.groupLabel,
      isOptional: li.isOptional,
      isSelected: li.isSelected,
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
    }));
  }

  if (!seedClientId) return { error: "A client is required to create a quote" } as const;

  // Retry the create if quoteNumber collides — concurrent creates in the
  // same year can race. After two retries, surface the error.
  for (let attempt = 0; attempt < 3; attempt++) {
    const number = await nextQuoteNumber();
    try {
      const totals = computeQuoteTotals({
        lineItems: seedItems.map((li) => ({
          quantity: li.quantity,
          unitPrice: li.unitPrice,
          discountType: li.discountType,
          discountValue: li.discountValue,
          isOptional: li.isOptional,
          isSelected: li.isSelected,
        })),
        discountType: seedDiscountType,
        discountValue: seedDiscountValue,
        taxRate: seedTaxRate,
      });

      const created = await db.quote.create({
        data: {
          quoteNumber: number,
          clientId: seedClientId,
          projectId: seedProjectId,
          status: "DRAFT",
          title: seedTitle,
          introText: seedIntro,
          termsText: seedTerms,
          currency: seedCurrency,
          discountType: seedDiscountType,
          discountValue: seedDiscountValue,
          taxRate: seedTaxRate,
          taxAmount: totals.taxAmount,
          subtotal: totals.subtotal,
          total: totals.total,
          createdById: user.id,
          lineItems: {
            create: seedItems.map((li, i) => ({
              position: li.position ?? i,
              groupLabel: li.groupLabel,
              isOptional: li.isOptional,
              isSelected: li.isSelected,
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
              subtotal: totals.lineSubtotals[i]?.subtotal ?? 0,
            })),
          },
        },
      });

      await logQuoteEvent(created.id, "created", user.id, {
        fromTemplateId: opts.fromTemplateId,
        fromQuoteId: opts.fromQuoteId,
      });
      await logActivity("created", "quote", created.id, user.id, created.title, {
        clientId: created.clientId,
        projectId: created.projectId,
      });
      revalidateQuote(created.id, {
        clientId: created.clientId,
        projectId: created.projectId,
      });
      return { success: true, id: created.id, quoteNumber: created.quoteNumber } as const;
    } catch (err) {
      // Unique constraint on quoteNumber — retry with the next number.
      const code = (err as { code?: string })?.code;
      if (code === "P2002" && attempt < 2) continue;
      throw err;
    }
  }

  return { error: "Could not allocate a quote number after multiple attempts" } as const;
}

export async function updateQuote(input: { id: string } & QuoteUpsertInput) {
  const user = await requireAuth();
  const perms = await resolveModulePerms(user.id, user.role, "quotes");
  if (!perms.canEdit) return { error: "Permission denied" } as const;

  const parsed = quoteUpsertSchema.safeParse(input);
  if (!parsed.success) {
    return {
      error: "Invalid input",
      fieldErrors: parsed.error.flatten().fieldErrors,
    } as const;
  }

  const existing = await db.quote.findUnique({
    where: { id: input.id },
    select: {
      id: true,
      status: true,
      clientId: true,
      projectId: true,
    },
  });
  if (!existing) return { error: "Quote not found" } as const;

  // Phase 1 only allows editing of drafts and revisions. Sent/accepted
  // quotes need an explicit `reviseQuote` (Phase 2) before they can be
  // changed — this protects the public-facing snapshot the client saw.
  if (existing.status !== "DRAFT" && existing.status !== "REVISED") {
    return {
      error: `Quote in status ${existing.status} cannot be edited. Create a revision instead.`,
    } as const;
  }

  await persistQuoteWithItems(input.id, parsed.data);
  await logQuoteEvent(input.id, "edited", user.id);
  await logActivity("updated", "quote", input.id, user.id, parsed.data.title, {
    clientId: parsed.data.clientId,
    projectId: parsed.data.projectId ?? null,
  });
  revalidateQuote(input.id, {
    clientId: parsed.data.clientId,
    previousClientId: existing.clientId,
    projectId: parsed.data.projectId ?? null,
    previousProjectId: existing.projectId,
  });
  return { success: true } as const;
}

export async function deleteQuote(id: string) {
  const user = await requireAuth();
  const perms = await resolveModulePerms(user.id, user.role, "quotes");
  if (!perms.canDelete) return { error: "Permission denied" } as const;

  const quote = await db.quote.findUnique({
    where: { id },
    select: { id: true, status: true, clientId: true, projectId: true, title: true },
  });
  if (!quote) return { error: "Quote not found" } as const;

  // Only drafts can be hard-deleted. Sent/accepted quotes are part of the
  // audit trail and should be preserved — Phase 2 will add archival.
  if (quote.status !== "DRAFT") {
    return {
      error: `Only draft quotes can be deleted (current status: ${quote.status})`,
    } as const;
  }

  await db.quote.delete({ where: { id } });
  await logActivity("deleted", "quote", id, user.id, quote.title, {
    clientId: quote.clientId,
    projectId: quote.projectId,
  });
  revalidateQuote(id, { clientId: quote.clientId, projectId: quote.projectId });
  return { success: true } as const;
}

export async function duplicateQuote(id: string) {
  return createQuote({ fromQuoteId: id });
}

export async function saveQuoteAsTemplate(input: { id: string; name: string; description?: string | null }) {
  const user = await requireAuth();
  const perms = await resolveModulePerms(user.id, user.role, "quotes");
  if (!perms.canCreate) return { error: "Permission denied" } as const;

  const name = input.name?.trim();
  if (!name) return { error: "Template name is required" } as const;

  const quote = await db.quote.findUnique({
    where: { id: input.id },
    include: { lineItems: { orderBy: { position: "asc" } } },
  });
  if (!quote) return { error: "Quote not found" } as const;

  const tpl = await db.quoteTemplate.create({
    data: {
      name,
      description: normalizeOptional(input.description ?? null),
      introText: quote.introText,
      termsText: quote.termsText,
      createdById: user.id,
      lineItems: {
        create: quote.lineItems.map((li, i) => ({
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
  return { success: true, id: tpl.id } as const;
}

// ─── Stubs for later phases ─────────────────────────────────────────────

export async function convertQuoteToProject(id: string) {
  // Phase 1: stub — returns a hint rather than throwing so the UI can
  // display "Coming soon" or hide the button entirely. Phase 2 fills this
  // in once accept/sent flows exist.
  void id;
  return {
    error: "Quote → Project conversion is not yet implemented (Phase 2)",
    notImplemented: true as const,
  };
}

export async function convertQuoteToInvoice(id: string) {
  // Stub — invoices module doesn't exist yet. Phase 2+.
  void id;
  return {
    error: "Quote → Invoice conversion is not yet implemented",
    notImplemented: true as const,
  };
}

// ─── Quote queries ──────────────────────────────────────────────────────

export interface QuoteListFilters {
  status?: QuoteStatus;
  clientId?: string;
  projectId?: string;
  assignedToId?: string;
  search?: string;
}

export async function listQuotes(filters: QuoteListFilters = {}) {
  const user = await requireAuth();
  const perms = await resolveModulePerms(user.id, user.role, "quotes");
  if (!perms.canView) return { error: "Permission denied" } as const;

  const where: Prisma.QuoteWhereInput = {};
  if (filters.status) where.status = filters.status;
  if (filters.clientId) where.clientId = filters.clientId;
  if (filters.projectId) where.projectId = filters.projectId;
  if (filters.assignedToId) where.assignedToId = filters.assignedToId;
  if (filters.search) {
    where.OR = [
      { title: { contains: filters.search, mode: "insensitive" } },
      { quoteNumber: { contains: filters.search, mode: "insensitive" } },
      { client: { name: { contains: filters.search, mode: "insensitive" } } },
    ];
  }

  const quotes = await db.quote.findMany({
    where,
    orderBy: { updatedAt: "desc" },
    include: {
      client: { select: { id: true, name: true } },
      project: { select: { id: true, name: true } },
      assignedTo: { select: { id: true, name: true } },
    },
  });

  return { success: true, quotes } as const;
}
