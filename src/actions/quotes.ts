"use server";

import { db } from "@/lib/db";
import { requireAuth, resolveModulePerms } from "@/lib/permissions";
import { logActivity } from "@/lib/activity";
import { revalidateQuote, revalidateProject } from "@/lib/revalidate-entity";
import { computeQuoteTotals, formatCurrency } from "@/lib/quotes/totals";
import { nextQuoteNumber } from "@/lib/quotes/numbering";
import { generateQuoteToken } from "@/lib/quotes/tokens";
import { sendFromTemplate } from "@/lib/email";
import { absoluteUrl } from "@/lib/url";
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

// ─── Send / revise / accept / reject (Phase 2) ──────────────────────────

const sendQuoteSchema = z.object({
  id: z.string().min(1),
  /** Optional override for the recipient. Defaults to the client's primary
   *  contact email. */
  to: z.string().email().nullish(),
  /** Optional subject override for one-off sends. */
  subject: z.string().min(1).nullish(),
  /** Optional message override prepended above the standard CTA. */
  message: z.string().nullish(),
});

export async function sendQuote(input: z.infer<typeof sendQuoteSchema>) {
  const user = await requireAuth();
  const perms = await resolveModulePerms(user.id, user.role, "quotes");
  if (!perms.canEdit) return { error: "Permission denied" } as const;

  const parsed = sendQuoteSchema.safeParse(input);
  if (!parsed.success) {
    return {
      error: "Invalid input",
      fieldErrors: parsed.error.flatten().fieldErrors,
    } as const;
  }

  const quote = await db.quote.findUnique({
    where: { id: parsed.data.id },
    include: {
      client: {
        select: {
          id: true,
          name: true,
          contacts: {
            where: { isPrimary: true },
            select: { name: true, email: true },
            take: 1,
          },
        },
      },
    },
  });
  if (!quote) return { error: "Quote not found" } as const;

  // Sending is allowed from DRAFT and REVISED only. Already-sent quotes
  // get re-sent via the same action — but we still log a fresh event.
  const isInitialSend = quote.status === "DRAFT" || quote.status === "REVISED";

  // Resolve recipient: explicit override > primary contact > error.
  const recipient =
    parsed.data.to?.trim() ||
    quote.client.contacts[0]?.email ||
    null;
  if (!recipient) {
    return {
      error: "No recipient email — set a primary contact on the client or supply one in the Send dialog",
    } as const;
  }

  // Mint or reuse the public token. Reusing on resend keeps any links
  // already shared (Slack/email forwards) working.
  const publicToken = quote.publicToken ?? generateQuoteToken();
  const shareUrl = absoluteUrl(`/q/${publicToken}`);

  await db.quote.update({
    where: { id: quote.id },
    data: {
      publicToken,
      sentAt: quote.sentAt ?? new Date(),
      status: isInitialSend ? "SENT" : quote.status,
    },
  });

  await logQuoteEvent(quote.id, "sent", user.id, {
    to: recipient,
    resend: !isInitialSend,
  });

  // Email the client. We use the existing notification template shape so
  // the look matches transactional emails the rest of the app sends. The
  // dedicated quote template can come later if marketing wants finer
  // control over branding.
  await sendFromTemplate(
    "quote-sent",
    {
      recipientName: quote.client.contacts[0]?.name ?? quote.client.name,
      senderName: user.name,
      quoteNumber: quote.quoteNumber,
      quoteTitle: quote.title,
      total: formatCurrency(quote.total, quote.currency),
      validUntil: quote.validUntil
        ? new Date(quote.validUntil).toLocaleDateString()
        : null,
      message: parsed.data.message?.trim() || null,
      shareUrl,
      subjectOverride: parsed.data.subject?.trim() || null,
    },
    {
      to: recipient,
      entityType: "quote",
      entityId: quote.id,
    }
  );

  await logActivity(
    isInitialSend ? "sent" : "re-sent",
    "quote",
    quote.id,
    user.id,
    quote.title,
    { clientId: quote.clientId, projectId: quote.projectId }
  );
  revalidateQuote(quote.id, {
    clientId: quote.clientId,
    projectId: quote.projectId,
  });

  return { success: true, shareUrl, recipient } as const;
}

export async function reviseQuote(id: string) {
  const user = await requireAuth();
  const perms = await resolveModulePerms(user.id, user.role, "quotes");
  if (!perms.canEdit) return { error: "Permission denied" } as const;

  const original = await db.quote.findUnique({
    where: { id },
    select: { id: true, status: true, clientId: true, projectId: true },
  });
  if (!original) return { error: "Quote not found" } as const;
  if (original.status === "DRAFT") {
    return { error: "Drafts can be edited directly — no revision needed" } as const;
  }

  // Spawn a new draft seeded from the original via the existing duplicate
  // path, then link the parent and flip the original to REVISED.
  const child = await createQuote({ fromQuoteId: id });
  if ("error" in child) return child;

  await db.quote.update({
    where: { id: child.id },
    data: { parentQuoteId: id, status: "DRAFT" },
  });
  await db.quote.update({
    where: { id },
    data: { status: "REVISED" },
  });

  await logQuoteEvent(id, "revised", user.id, { newQuoteId: child.id });
  await logQuoteEvent(child.id, "created", user.id, {
    revisionOf: id,
  });
  revalidateQuote(id, {
    clientId: original.clientId,
    projectId: original.projectId,
  });
  revalidateQuote(child.id, {
    clientId: original.clientId,
    projectId: original.projectId,
  });

  return { success: true, id: child.id } as const;
}

// ─── Public token actions (no full auth) ────────────────────────────────
//
// These run in response to the quote recipient clicking the link in their
// email. They don't require an OpsHub session — the token is the auth.
// Each action mints a QuoteEvent with actorType="client" so the audit
// trail clearly distinguishes recipient actions from owner actions.

const acceptPublicSchema = z.object({
  token: z.string().min(1),
  signatureName: z.string().min(1, "Type your name to sign"),
  signatureData: z.string().nullish(),
  /** IDs of optional rows the client toggled ON. */
  selectedOptionalItemIds: z.array(z.string()).default([]),
  /** Forwarded by the public route handler so we can audit which IP signed. */
  ip: z.string().nullish(),
});

export async function acceptQuotePublic(input: z.infer<typeof acceptPublicSchema>) {
  const parsed = acceptPublicSchema.safeParse(input);
  if (!parsed.success) {
    return {
      error: "Invalid input",
      fieldErrors: parsed.error.flatten().fieldErrors,
    } as const;
  }

  const quote = await db.quote.findUnique({
    where: { publicToken: parsed.data.token },
    include: { lineItems: true },
  });
  if (!quote) return { error: "Quote not found" } as const;
  if (quote.status === "ACCEPTED" || quote.status === "REJECTED") {
    return { error: `This quote was already ${quote.status.toLowerCase()}.` } as const;
  }
  if (quote.validUntil && quote.validUntil.getTime() < Date.now()) {
    return { error: "This quote has expired." } as const;
  }

  const selectedSet = new Set(parsed.data.selectedOptionalItemIds);

  // Recompute totals based on the client's optional-row selections so the
  // accepted total reflects exactly what they agreed to.
  const updatedItems = quote.lineItems.map((li) => ({
    id: li.id,
    isOptional: li.isOptional,
    isSelected: li.isOptional ? selectedSet.has(li.id) : true,
    quantity: li.quantity,
    unitPrice: li.unitPrice,
    discountType: li.discountType,
    discountValue: li.discountValue,
  }));
  const totals = computeQuoteTotals({
    lineItems: updatedItems,
    discountType: quote.discountType,
    discountValue: quote.discountValue,
    taxRate: quote.taxRate,
  });

  await db.$transaction(async (tx) => {
    await tx.quote.update({
      where: { id: quote.id },
      data: {
        status: "ACCEPTED",
        acceptedAt: new Date(),
        acceptedSignatureName: parsed.data.signatureName,
        acceptedSignatureData: parsed.data.signatureData ?? null,
        acceptedIp: parsed.data.ip ?? null,
        subtotal: totals.subtotal,
        taxAmount: totals.taxAmount,
        total: totals.total,
      },
    });

    // Persist optional-row selections — what the client picks lives on
    // the row itself so the read view reflects the accepted shape.
    for (let i = 0; i < quote.lineItems.length; i++) {
      const li = quote.lineItems[i];
      const isSelected = li.isOptional ? selectedSet.has(li.id) : true;
      await tx.quoteLineItem.update({
        where: { id: li.id },
        data: {
          isSelected,
          subtotal: totals.lineSubtotals[i]?.subtotal ?? 0,
        },
      });
    }
  });

  await db.quoteEvent.create({
    data: {
      quoteId: quote.id,
      eventType: "accepted",
      actorType: "client",
      actorId: null,
      metadata: JSON.stringify({
        signatureName: parsed.data.signatureName,
        ip: parsed.data.ip ?? null,
        acceptedTotal: totals.total,
      }),
    },
  });

  revalidateQuote(quote.id, {
    clientId: quote.clientId,
    projectId: quote.projectId,
  });
  revalidatePath(`/q/${parsed.data.token}`);
  return { success: true } as const;
}

const rejectPublicSchema = z.object({
  token: z.string().min(1),
  reason: z.string().nullish(),
  ip: z.string().nullish(),
});

export async function rejectQuotePublic(input: z.infer<typeof rejectPublicSchema>) {
  const parsed = rejectPublicSchema.safeParse(input);
  if (!parsed.success) {
    return {
      error: "Invalid input",
      fieldErrors: parsed.error.flatten().fieldErrors,
    } as const;
  }

  const quote = await db.quote.findUnique({
    where: { publicToken: parsed.data.token },
    select: {
      id: true,
      clientId: true,
      projectId: true,
      status: true,
    },
  });
  if (!quote) return { error: "Quote not found" } as const;
  if (quote.status === "ACCEPTED" || quote.status === "REJECTED") {
    return { error: `This quote was already ${quote.status.toLowerCase()}.` } as const;
  }

  await db.quote.update({
    where: { id: quote.id },
    data: {
      status: "REJECTED",
      rejectedAt: new Date(),
      rejectionReason: parsed.data.reason?.trim() || null,
    },
  });
  await db.quoteEvent.create({
    data: {
      quoteId: quote.id,
      eventType: "rejected",
      actorType: "client",
      metadata: parsed.data.reason
        ? JSON.stringify({ reason: parsed.data.reason, ip: parsed.data.ip ?? null })
        : null,
    },
  });

  revalidateQuote(quote.id, {
    clientId: quote.clientId,
    projectId: quote.projectId,
  });
  revalidatePath(`/q/${parsed.data.token}`);
  return { success: true } as const;
}

/**
 * Records that the client opened the public quote URL. Called from the
 * public page on first render. Idempotent — the first hit sets
 * firstViewedAt, subsequent hits only mint VIEWED events when the row
 * was not already in the VIEWED+ chain.
 */
export async function recordQuoteViewPublic(token: string, ip: string | null) {
  const quote = await db.quote.findUnique({
    where: { publicToken: token },
    select: { id: true, status: true, firstViewedAt: true, clientId: true, projectId: true },
  });
  if (!quote) return { error: "Quote not found" } as const;

  const isFirstView = quote.firstViewedAt == null;
  if (isFirstView) {
    await db.quote.update({
      where: { id: quote.id },
      data: {
        firstViewedAt: new Date(),
        // Only flip status forward — never back over ACCEPTED/REJECTED.
        status: quote.status === "SENT" ? "VIEWED" : quote.status,
      },
    });
    await db.quoteEvent.create({
      data: {
        quoteId: quote.id,
        eventType: "viewed",
        actorType: "client",
        metadata: ip ? JSON.stringify({ ip }) : null,
      },
    });
    revalidateQuote(quote.id, {
      clientId: quote.clientId,
      projectId: quote.projectId,
    });
  }
  return { success: true, isFirstView } as const;
}

// ─── Conversion to project (Phase 2) ─────────────────────────────────────

export async function convertQuoteToProject(id: string) {
  const user = await requireAuth();
  const perms = await resolveModulePerms(user.id, user.role, "quotes");
  if (!perms.canCreate) return { error: "Permission denied" } as const;

  const projectsPerms = await resolveModulePerms(user.id, user.role, "projects");
  if (!projectsPerms.canCreate) {
    return {
      error: "You don't have permission to create projects",
    } as const;
  }

  const quote = await db.quote.findUnique({
    where: { id },
    include: {
      lineItems: { orderBy: { position: "asc" } },
      project: { select: { id: true } },
    },
  });
  if (!quote) return { error: "Quote not found" } as const;
  if (quote.status !== "ACCEPTED") {
    return {
      error: "Only accepted quotes can be converted to projects",
    } as const;
  }
  if (quote.project) {
    return {
      error: "This quote is already linked to a project",
      existingProjectId: quote.project.id,
    } as const;
  }

  // Build a project description from the quote intro + line item names so
  // the resulting project has a sensible scope summary out of the gate.
  const scopeLines = quote.lineItems
    .filter((li) => !li.isOptional || li.isSelected)
    .map((li) => `• ${li.name}`)
    .join("\n");
  const description = [
    quote.introText?.trim(),
    scopeLines ? `Scope from quote ${quote.quoteNumber}:\n${scopeLines}` : null,
  ]
    .filter(Boolean)
    .join("\n\n");

  const project = await db.project.create({
    data: {
      name: quote.title,
      description: description || null,
      clientId: quote.clientId,
      status: "PLANNING",
    },
  });

  // Link the quote back to the new project so the embedded card on
  // /projects/[id] shows it under "Quotes".
  await db.quote.update({
    where: { id: quote.id },
    data: { projectId: project.id },
  });

  // Generate one milestone per non-optional, non-recurring line item so
  // delivery has a starting punch list. Recurring items are MRR
  // commitments rather than one-time deliverables, so they're skipped.
  const milestoneSeed = quote.lineItems.filter(
    (li) => (!li.isOptional || li.isSelected) && !li.isRecurring
  );
  if (milestoneSeed.length > 0) {
    await db.milestone.createMany({
      data: milestoneSeed.map((li) => ({
        title: li.name,
        description: li.description,
        projectId: project.id,
      })),
    });
  }

  await db.quoteEvent.create({
    data: {
      quoteId: quote.id,
      eventType: "converted_to_project",
      actorType: "user",
      actorId: user.id,
      metadata: JSON.stringify({ projectId: project.id }),
    },
  });
  await logActivity("created", "project", project.id, user.id, project.name, {
    clientId: project.clientId,
  });
  revalidateQuote(quote.id, {
    clientId: quote.clientId,
    projectId: project.id,
    previousProjectId: quote.projectId,
  });
  revalidateProject(project.id, { clientId: project.clientId });
  return { success: true, projectId: project.id } as const;
}

export async function convertQuoteToInvoice(id: string) {
  // Stub — the invoices module doesn't exist yet. Reserved so the editor
  // can show the menu item disabled with a tooltip rather than hiding it
  // entirely. Pre-flight checks here so wiring is one PR away.
  void id;
  return {
    error: "Invoices aren't enabled yet — contact your admin to turn them on.",
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
