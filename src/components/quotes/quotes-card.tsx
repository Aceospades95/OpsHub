import Link from "next/link";
import { format } from "date-fns";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/shared/status-badge";
import { formatCurrency } from "@/lib/quotes/totals";

import { QuickQuoteCreateButton } from "@/app/(platform)/quotes/quote-create-button";
import { db } from "@/lib/db";

interface Props {
  /** Either clientId or projectId must be provided. */
  clientId?: string;
  projectId?: string;
  canCreate: boolean;
  /** Max rows to render before linking to the full list. */
  limit?: number;
}

/**
 * Embedded list of quotes for a given client or project. Designed to drop
 * into a card map on `/clients/[id]` or `/projects/[id]` — header has a
 * "New Quote" button that pre-selects the parent entity.
 */
export async function QuotesCard({ clientId, projectId, canCreate, limit = 8 }: Props) {
  if (!clientId && !projectId) return null;

  const quotes = await db.quote.findMany({
    where: clientId ? { clientId, deletedAt: null } : { projectId, deletedAt: null },
    orderBy: { updatedAt: "desc" },
    include: { client: { select: { id: true, name: true } } },
    take: limit,
  });

  // Single deep-link target for "View all" — points to /quotes filtered.
  const filterParam = clientId
    ? `?clientId=${clientId}`
    : projectId
      ? `?projectId=${projectId}`
      : "";

  return (
    <Card className="h-full">
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2">Quotes ({quotes.length})</CardTitle>
          {canCreate && (
            <QuickQuoteCreateButton clientId={clientId} projectId={projectId} />
          )}
        </div>
      </CardHeader>
      <CardContent>
        {quotes.length === 0 ? (
          <p className="text-sm text-muted-foreground">No quotes yet.</p>
        ) : (
          <div className="space-y-2">
            {quotes.map((q) => (
              <Link
                key={q.id}
                href={`/quotes/${q.id}`}
                className="flex items-center justify-between rounded border border-border bg-muted p-3 hover:border-primary transition-colors"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="font-mono text-xs text-muted-foreground">
                      {q.quoteNumber}
                    </p>
                    <StatusBadge status={q.status} />
                  </div>
                  <p className="font-medium text-sm truncate">{q.title}</p>
                  <p className="text-xs text-muted-foreground">
                    Updated {format(q.updatedAt, "MMM d, yyyy")}
                  </p>
                </div>
                <div className="text-sm tabular-nums text-foreground">
                  {formatCurrency(q.total, q.currency)}
                </div>
              </Link>
            ))}
            {quotes.length === limit && (
              <Link
                href={`/quotes${filterParam}`}
                className="block text-xs text-primary hover:underline pt-1"
              >
                View all →
              </Link>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
