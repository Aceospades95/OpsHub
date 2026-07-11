import { db } from "@/lib/db";
import { getBranding } from "@/lib/branding";
import { readFile } from "@/lib/storage";
import { computeQuoteTotals } from "./totals";
import type { QuotePdfData } from "./pdf";

/**
 * Load the branded logo as raw bytes for the PDF renderer — react-pdf
 * can't fetch the app-relative `/api/files/…` URL from inside a route
 * handler, so we read straight through the storage driver. Only png/jpg
 * are embeddable; anything else (svg, webp) falls back to the company
 * name in the header.
 */
async function loadLogoBytes(
  fileId: string | null
): Promise<QuotePdfData["companyLogo"]> {
  if (!fileId) return null;
  const file = await readFile(fileId);
  if (!file) return null;
  const type = file.contentType.toLowerCase();
  const format = type.includes("png")
    ? ("png" as const)
    : type.includes("jpeg") || type.includes("jpg")
      ? ("jpg" as const)
      : null;
  if (!format) return null;
  return { data: file.buffer, format };
}

/**
 * Load a quote in the shape expected by the PDF/DOCX renderers. Used by
 * both the auth-gated owner download (`/api/quotes/:id/pdf`) and the
 * token-gated public download (`/api/public/quotes/:token/pdf`).
 */
export async function loadQuoteForExport(
  lookup: { id: string } | { token: string }
): Promise<QuotePdfData | null> {
  const quote = await db.quote.findFirst({
    where: "id" in lookup
      ? { id: lookup.id, deletedAt: null }
      : { publicToken: lookup.token, deletedAt: null },
    include: {
      client: { select: { name: true } },
      lineItems: { orderBy: { position: "asc" } },
    },
  });
  if (!quote) return null;

  const branding = await getBranding();

  // Recompute totals from the persisted line items so the PDF reflects
  // exactly what's stored — never a stale cached `total` column.
  const totals = computeQuoteTotals({
    lineItems: quote.lineItems.map((li) => ({
      quantity: li.quantity,
      unitPrice: li.unitPrice,
      discountType: li.discountType,
      discountValue: li.discountValue,
      isOptional: li.isOptional,
      isSelected: li.isSelected,
    })),
    discountType: quote.discountType,
    discountValue: quote.discountValue,
    taxRate: quote.taxRate,
  });

  return {
    quoteNumber: quote.quoteNumber,
    title: quote.title,
    status: quote.status,
    introText: quote.introText,
    assumptionsText: quote.assumptionsText,
    termsText: quote.termsText,
    companyLogoUrl: branding.companyLogoUrl,
    companyLogo: await loadLogoBytes(branding.companyLogoFileId),
    accentColor: branding.accentColor,
    currency: quote.currency,
    taxRate: quote.taxRate,
    validUntil: quote.validUntil,
    acceptedAt: quote.acceptedAt,
    acceptedSignatureName: quote.acceptedSignatureName,
    clientName: quote.client.name,
    companyName: branding.companyName,
    subtotal: totals.subtotal,
    discountAmount: totals.discountAmount,
    taxAmount: totals.taxAmount,
    total: totals.total,
    lineItems: quote.lineItems.map((li, i) => ({
      name: li.name,
      description: li.description,
      groupLabel: li.groupLabel,
      quantity: li.quantity,
      unit: li.unit,
      unitPrice: li.unitPrice,
      subtotal: totals.lineSubtotals[i]?.subtotal ?? li.subtotal,
      isOptional: li.isOptional,
      isSelected: li.isSelected,
      isRecurring: li.isRecurring,
      recurringInterval: li.recurringInterval,
    })),
  };
}
