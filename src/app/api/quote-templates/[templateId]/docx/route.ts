import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { getBranding } from "@/lib/branding";
import { requireAuth, resolveModulePerms } from "@/lib/permissions";
import { computeQuoteTotals } from "@/lib/quotes/totals";
import { renderQuoteDocx, type DocxLineItem } from "@/lib/quotes/docx";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Standalone DOCX export of a quote template — what the spec calls the
 * "downloadable template for use elsewhere". A template has no client
 * and no totals discount/tax context, so we render against zero defaults
 * and let the recipient fill in those details outside OpsHub.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ templateId: string }> }
) {
  const user = await requireAuth();
  const perms = await resolveModulePerms(user.id, user.role, "quotes");
  if (!perms.canView) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { templateId } = await params;
  const template = await db.quoteTemplate.findUnique({
    where: { id: templateId },
    include: { lineItems: { orderBy: { position: "asc" } } },
  });
  if (!template) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const branding = await getBranding();

  // Compute the template's totals at face value — no quote-level
  // discount or tax (templates don't carry those fields).
  const totals = computeQuoteTotals({
    lineItems: template.lineItems.map((li) => ({
      quantity: li.quantity,
      unitPrice: li.unitPrice,
      discountType: li.discountType,
      discountValue: li.discountValue,
      isOptional: li.isOptional,
      // Templates default to "all selected" — recipients adjust later.
      isSelected: true,
    })),
    discountType: "NONE",
    discountValue: 0,
    taxRate: null,
  });

  const lineItems: DocxLineItem[] = template.lineItems.map((li, i) => ({
    name: li.name,
    description: li.description,
    groupLabel: li.groupLabel,
    quantity: li.quantity,
    unit: li.unit,
    unitPrice: li.unitPrice,
    subtotal: totals.lineSubtotals[i]?.subtotal ?? 0,
    isOptional: li.isOptional,
    isRecurring: li.isRecurring,
    recurringInterval: li.recurringInterval,
  }));

  const buffer = await renderQuoteDocx({
    reference: `Template`,
    title: template.name,
    introText: template.introText,
    termsText: template.termsText,
    currency: "USD",
    taxRate: null,
    meta: template.description ?? null,
    subtotal: totals.subtotal,
    discountAmount: 0,
    taxAmount: 0,
    total: totals.total,
    lineItems,
    companyName: branding.companyName,
  });

  // Filename: `{slug}.docx` — strip non-filename-safe chars from the
  // template name. Falls back to "template" if the entire name was
  // unsafe characters.
  const safeName =
    template.name
      .replace(/[^\w\s-]/g, "")
      .trim()
      .replace(/\s+/g, "-")
      .toLowerCase() || "template";

  return new NextResponse(buffer as unknown as BodyInit, {
    status: 200,
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Content-Disposition": `attachment; filename="${safeName}.docx"`,
      "Cache-Control": "private, no-store",
    },
  });
}
