import { db } from "@/lib/db";
import { getBranding } from "@/lib/branding";
import { computeQuoteTotals } from "./totals";
import type { QuotePdfData } from "./pdf";

/**
 * Load a quote in the shape expected by the PDF/DOCX renderers. Used by
 * both the auth-gated owner download (`/api/quotes/:id/pdf`) and the
 * token-gated public download (`/api/public/quotes/:token/pdf`).
 */
export async function loadQuoteForExport(
  lookup: { id: string } | { token: string }
): Promise<QuotePdfData | null> {
  const quote = await db.quote.findUnique({
    where: "id" in lookup ? { id: lookup.id } : { publicToken: lookup.token },
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
