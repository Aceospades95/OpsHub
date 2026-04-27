import { notFound } from "next/navigation";
import { headers as nextHeaders } from "next/headers";
import { format } from "date-fns";

import { db } from "@/lib/db";
import { getBranding } from "@/lib/branding";
import { computeQuoteTotals, formatCurrency } from "@/lib/quotes/totals";
import { recordQuoteViewPublic } from "@/actions/quotes";

import { PublicQuoteClient } from "./public-quote-client";

interface Props {
  params: Promise<{ token: string }>;
}

// Public quote page — no auth required, gated only by the cryptographic
// token. Each first-render records a "viewed" event on the quote.
export const dynamic = "force-dynamic";

export default async function PublicQuotePage({ params }: Props) {
  const { token } = await params;
  const quote = await db.quote.findUnique({
    where: { publicToken: token },
    include: {
      client: { select: { id: true, name: true } },
      lineItems: { orderBy: { position: "asc" } },
    },
  });
  if (!quote) notFound();

  const branding = await getBranding();
  const headersList = await nextHeaders();
  const ip =
    headersList.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    headersList.get("x-real-ip") ||
    null;

  // Fire-and-forget the view record — failure here mustn't block the
  // recipient from seeing the quote.
  void recordQuoteViewPublic(token, ip).catch(() => {});

  // Pre-compute totals so SSR HTML renders identical numbers to the
  // client-side recompute when the recipient toggles optional rows.
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

  // Group line items so the public view renders distinct sections for
  // any group_label the owner specified ("Hardware", "Optional Add-ons",
  // etc.). Items without a label collapse into a single "default" group.
  const groups = new Map<
    string,
    { label: string | null; items: typeof quote.lineItems }
  >();
  for (const li of quote.lineItems) {
    const key = li.groupLabel ?? "__default";
    if (!groups.has(key)) {
      groups.set(key, { label: li.groupLabel, items: [] });
    }
    groups.get(key)!.items.push(li);
  }

  const expired =
    quote.validUntil != null && quote.validUntil.getTime() < Date.now();

  return (
    <main className="min-h-screen bg-neutral-50 py-8 px-4 print:bg-white print:py-0">
      <div className="max-w-3xl mx-auto">
        <header className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            {branding.companyLogoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={branding.companyLogoUrl}
                alt={branding.companyName ?? "Company logo"}
                className="h-10 w-auto"
              />
            ) : (
              <span className="font-semibold text-lg">
                {branding.companyName ?? "OpsHub"}
              </span>
            )}
          </div>
          <a
            href={`/api/public/quotes/${token}/pdf`}
            className="text-sm text-neutral-600 hover:text-neutral-900 hover:underline"
          >
            Download PDF
          </a>
        </header>

        <PublicQuoteClient
          quote={{
            id: quote.id,
            quoteNumber: quote.quoteNumber,
            title: quote.title,
            introText: quote.introText,
            assumptionsText: quote.assumptionsText,
            termsText: quote.termsText,
            currency: quote.currency,
            status: quote.status,
            validUntil: quote.validUntil ? quote.validUntil.toISOString() : null,
            taxRate: quote.taxRate,
            discountType: quote.discountType,
            discountValue: quote.discountValue,
            acceptedAt: quote.acceptedAt
              ? quote.acceptedAt.toISOString()
              : null,
            acceptedSignatureName: quote.acceptedSignatureName,
            rejectedAt: quote.rejectedAt
              ? quote.rejectedAt.toISOString()
              : null,
            rejectionReason: quote.rejectionReason,
            clientName: quote.client.name,
          }}
          token={token}
          groups={Array.from(groups.values()).map((g) => ({
            label: g.label,
            items: g.items.map((li) => ({
              id: li.id,
              name: li.name,
              description: li.description,
              quantity: li.quantity,
              unit: li.unit,
              unitPrice: li.unitPrice,
              isOptional: li.isOptional,
              isSelected: li.isSelected,
              isRecurring: li.isRecurring,
              recurringInterval: li.recurringInterval,
              discountType: li.discountType,
              discountValue: li.discountValue,
            })),
          }))}
          initialTotals={totals}
          expired={expired}
        />

        <p className="text-center text-xs text-neutral-400 mt-8">
          {quote.acceptedAt && quote.acceptedSignatureName
            ? `Signed by ${quote.acceptedSignatureName} on ${format(quote.acceptedAt, "MMM d, yyyy 'at' h:mm a")}`
            : "Sent via OpsHub"}
        </p>
      </div>
    </main>
  );
}
