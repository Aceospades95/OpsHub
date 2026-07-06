import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { getBranding } from "@/lib/branding";
import { requireAuth, resolveModulePerms } from "@/lib/permissions";
import { canAccessQuote } from "@/lib/quotes/access";
import { computeQuoteTotals } from "@/lib/quotes/totals";
import { renderQuoteDocx, type DocxLineItem } from "@/lib/quotes/docx";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ quoteId: string }> }
) {
  const user = await requireAuth();
  const perms = await resolveModulePerms(user.id, user.role, "quotes");
  if (!perms.canView) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { quoteId } = await params;
  const quote = await db.quote.findFirst({
    where: { id: quoteId, deletedAt: null },
    include: {
      client: { select: { name: true } },
      lineItems: { orderBy: { position: "asc" } },
    },
  });
  if (!quote) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  // Per-quote gate on top of the module gate: non-org-wide roles can only
  // export their own quotes. 404 (not 403) so ids can't be probed.
  if (!canAccessQuote(user, quote)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const branding = await getBranding();

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

  const lineItems: DocxLineItem[] = quote.lineItems.map((li, i) => ({
    name: li.name,
    description: li.description,
    groupLabel: li.groupLabel,
    quantity: li.quantity,
    unit: li.unit,
    unitPrice: li.unitPrice,
    subtotal: totals.lineSubtotals[i]?.subtotal ?? li.subtotal,
    isOptional: li.isOptional,
    isRecurring: li.isRecurring,
    recurringInterval: li.recurringInterval,
  }));

  const meta = [
    `Prepared for ${quote.client.name}`,
    quote.validUntil
      ? `Valid until ${quote.validUntil.toLocaleDateString()}`
      : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const buffer = await renderQuoteDocx({
    reference: quote.quoteNumber,
    title: quote.title,
    introText: quote.introText,
    assumptionsText: quote.assumptionsText,
    termsText: quote.termsText,
    currency: quote.currency,
    taxRate: quote.taxRate,
    meta: meta || null,
    subtotal: totals.subtotal,
    discountAmount: totals.discountAmount,
    taxAmount: totals.taxAmount,
    total: totals.total,
    lineItems,
    companyName: branding.companyName,
  });

  return new NextResponse(buffer as unknown as BodyInit, {
    status: 200,
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Content-Disposition": `attachment; filename="${quote.quoteNumber}.docx"`,
      "Cache-Control": "private, no-store",
    },
  });
}
