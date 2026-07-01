import Link from "next/link";
import { notFound } from "next/navigation";
import { formatCalendarDate } from "@/lib/dates";

import { db } from "@/lib/db";
import { requireAuth, resolveModulePerms } from "@/lib/permissions";
import { AccessDenied } from "@/components/shared/access-denied";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatCurrency } from "@/lib/quotes/totals";
import { canAccessQuote } from "@/lib/quotes/access";
import { QuoteActions } from "./quote-actions";

interface Props {
  params: Promise<{ quoteId: string }>;
}

export default async function QuoteDetailPage({ params }: Props) {
  const { quoteId } = await params;
  const user = await requireAuth();
  const perms = await resolveModulePerms(user.id, user.role, "quotes");
  if (!perms.canView) {
    return (
      <AccessDenied
        module="quotes"
        moduleLabel="Quotes"
        moduleDescription="Stored sales quotes and proposals"
      />
    );
  }

  const quote = await db.quote.findFirst({
    where: { id: quoteId, deletedAt: null },
    include: {
      client: { select: { id: true, name: true } },
      project: { select: { id: true, name: true } },
      createdBy: { select: { id: true, name: true } },
      assignedTo: { select: { id: true, name: true } },
      lineItems: { orderBy: { position: "asc" } },
    },
  });
  if (!quote) notFound();
  // Non-org-wide roles only reach their own quotes. notFound (not 403)
  // so probing ids doesn't confirm a quote exists.
  if (!canAccessQuote(user, quote)) notFound();

  // Recompute the discount amount from cached totals — saved with the
  // quote — so the read view doesn't drift if the schema's cached
  // total + taxAmount + subtotal disagree (shouldn't happen, but
  // computing defensively here is essentially free).
  const discountAmount = Math.max(
    0,
    quote.subtotal - (quote.total - quote.taxAmount)
  );

  return (
    <div>
      <PageHeader
        title={
          /* Round-6: legacy quotes saved before round-4's auto-
           *  derived title shipped land here with title=
           *  "Untitled Quote". Mirror the /quotes list fallback so
           *  the H1 never reads as a placeholder. */
          quote.title === "Untitled Quote" || !quote.title.trim()
            ? `${quote.client.name} — ${quote.quoteNumber}`
            : quote.title
        }
        description={quote.quoteNumber}
        actions={
          <div className="flex items-center gap-2">
            {perms.canEdit && (
              <Link href={`/quotes/${quote.id}/edit`}>
                <Button>Edit</Button>
              </Link>
            )}
            <QuoteActions
              quoteId={quote.id}
              canEdit={perms.canEdit}
              canDelete={perms.canDelete}
              hasProject={quote.project != null}
            />
          </div>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Overview</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
                <div>
                  <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                    Client
                  </dt>
                  <dd className="mt-1">
                    <Link
                      href={`/clients/${quote.client.id}`}
                      className="hover:text-primary hover:underline"
                    >
                      {quote.client.name}
                    </Link>
                  </dd>
                </div>
                <div>
                  <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                    Project
                  </dt>
                  <dd className="mt-1">
                    {quote.project ? (
                      <Link
                        href={`/projects/${quote.project.id}`}
                        className="hover:text-primary hover:underline"
                      >
                        {quote.project.name}
                      </Link>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                    Valid until
                  </dt>
                  <dd className="mt-1">
                    {quote.validUntil
                      ? formatCalendarDate(quote.validUntil, "MMMM d, yyyy")
                      : <span className="text-muted-foreground">—</span>}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                    Owner
                  </dt>
                  <dd className="mt-1">
                    {quote.assignedTo ? (
                      <Link
                        href={`/team/${quote.assignedTo.id}`}
                        className="hover:text-primary hover:underline"
                      >
                        {quote.assignedTo.name}
                      </Link>
                    ) : (
                      <Link
                        href={`/team/${quote.createdBy.id}`}
                        className="text-muted-foreground hover:text-primary hover:underline"
                      >
                        {quote.createdBy.name} (created)
                      </Link>
                    )}
                  </dd>
                </div>
              </dl>

              {quote.introText && (
                <div className="pt-4 border-t border-border">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground mb-1">
                    Intro
                  </p>
                  <p className="whitespace-pre-wrap text-sm">{quote.introText}</p>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Line items</CardTitle>
            </CardHeader>
            <CardContent>
              {quote.lineItems.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No line items yet.{" "}
                  {perms.canEdit && (
                    <Link href={`/quotes/${quote.id}/edit`} className="text-primary hover:underline">
                      Add some.
                    </Link>
                  )}
                </p>
              ) : (
                <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs uppercase tracking-wide text-muted-foreground">
                      <th className="text-left font-medium pb-2">Item</th>
                      <th className="text-right font-medium pb-2">Qty</th>
                      <th className="text-right font-medium pb-2">Unit price</th>
                      <th className="text-right font-medium pb-2">Subtotal</th>
                    </tr>
                  </thead>
                  <tbody>
                    {quote.lineItems.map((li) => (
                      <tr key={li.id} className="border-t border-border">
                        <td className="py-3 align-top">
                          <p className="font-medium">{li.name}</p>
                          {li.description && (
                            <p className="text-xs text-muted-foreground whitespace-pre-wrap mt-1">
                              {li.description}
                            </p>
                          )}
                          <div className="flex flex-wrap gap-1.5 mt-1.5">
                            {li.groupLabel && (
                              <Badge variant="outline" className="text-xs">
                                {li.groupLabel}
                              </Badge>
                            )}
                            {li.isRecurring && (
                              <Badge variant="secondary" className="text-xs">
                                {li.recurringInterval?.toLowerCase() ?? "recurring"}
                              </Badge>
                            )}
                            {li.isOptional && (
                              <Badge variant="outline" className="text-xs">
                                Optional
                              </Badge>
                            )}
                          </div>
                        </td>
                        <td className="py-3 align-top text-right tabular-nums">
                          {li.quantity}
                          {li.unit ? ` ${li.unit}` : ""}
                        </td>
                        <td className="py-3 align-top text-right tabular-nums">
                          {formatCurrency(li.unitPrice, quote.currency)}
                        </td>
                        <td className="py-3 align-top text-right tabular-nums">
                          {formatCurrency(li.subtotal, quote.currency)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                </div>
              )}
            </CardContent>
          </Card>

          {quote.assumptionsText && (
            <Card>
              <CardHeader>
                <CardTitle>Assumptions</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm whitespace-pre-wrap text-muted-foreground">
                  {quote.assumptionsText}
                </p>
              </CardContent>
            </Card>
          )}

          {quote.termsText && (
            <Card>
              <CardHeader>
                <CardTitle>Terms</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm whitespace-pre-wrap text-muted-foreground">
                  {quote.termsText}
                </p>
              </CardContent>
            </Card>
          )}
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Totals</CardTitle>
            </CardHeader>
            <CardContent className="text-sm">
              <dl className="space-y-2">
                <div className="flex items-center justify-between">
                  <dt className="text-muted-foreground">Subtotal</dt>
                  <dd className="tabular-nums">
                    {formatCurrency(quote.subtotal, quote.currency)}
                  </dd>
                </div>
                {quote.discountType !== "NONE" && quote.discountValue > 0 && (
                  <div className="flex items-center justify-between">
                    <dt className="text-muted-foreground">
                      Discount
                      {quote.discountType === "PERCENT"
                        ? ` (${quote.discountValue}%)`
                        : ""}
                    </dt>
                    <dd className="tabular-nums">
                      −{formatCurrency(discountAmount, quote.currency)}
                    </dd>
                  </div>
                )}
                {quote.taxRate != null && (
                  <div className="flex items-center justify-between">
                    <dt className="text-muted-foreground">
                      Tax ({quote.taxRate}%)
                    </dt>
                    <dd className="tabular-nums">
                      {formatCurrency(quote.taxAmount, quote.currency)}
                    </dd>
                  </div>
                )}
                <div className="flex items-center justify-between border-t border-border pt-2 text-base font-semibold">
                  <dt>Total</dt>
                  <dd className="tabular-nums">
                    {formatCurrency(quote.total, quote.currency)}
                  </dd>
                </div>
              </dl>
            </CardContent>
          </Card>

          {quote.internalNotes && (
            <Card>
              <CardHeader>
                <CardTitle>Internal notes</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm whitespace-pre-wrap text-muted-foreground">
                  {quote.internalNotes}
                </p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
