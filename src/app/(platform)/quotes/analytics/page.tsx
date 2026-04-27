import Link from "next/link";
import { format } from "date-fns";

import { requireAuth, resolveModulePerms } from "@/lib/permissions";
import { AccessDenied } from "@/components/shared/access-denied";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/shared/status-badge";
import { getQuoteAnalytics } from "@/lib/quotes/analytics";
import { formatCurrency } from "@/lib/quotes/totals";

export const dynamic = "force-dynamic";

export default async function QuoteAnalyticsPage() {
  const user = await requireAuth();
  const perms = await resolveModulePerms(user.id, user.role, "quotes");
  if (!perms.canView) {
    return (
      <AccessDenied
        module="quotes"
        moduleLabel="Quotes"
        moduleDescription="Sales quotes, line-item builder, templates, and catalog"
      />
    );
  }

  const analytics = await getQuoteAnalytics(90);

  // Compute the funnel cap for the bar widths so the longest bar fills
  // the available track. Avoids divide-by-zero on a fresh install.
  const maxStatusValue = Math.max(
    1,
    ...analytics.statusBreakdown.map((s) => s.value)
  );
  const maxClientValue = Math.max(
    1,
    ...analytics.topClients.map((c) => c.acceptedTotal)
  );

  return (
    <div>
      <PageHeader
        title="Quote analytics"
        description={`Pipeline performance over the last ${analytics.windowDays} days`}
        actions={
          <Link
            href="/quotes"
            className="text-sm text-muted-foreground hover:text-foreground hover:underline"
          >
            ← Back to quotes
          </Link>
        }
      />

      {/* Headline metrics */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <MetricCard
          label="Open pipeline"
          value={formatCurrency(analytics.openPipelineValue)}
          sub={`${analytics.openCount} quote${analytics.openCount === 1 ? "" : "s"}`}
        />
        <MetricCard
          label={`Accepted (${analytics.windowDays}d)`}
          value={formatCurrency(analytics.acceptedValue)}
          sub={`${analytics.acceptedCount} closed`}
        />
        <MetricCard
          label="Win rate"
          value={analytics.winRate == null ? "—" : `${analytics.winRate}%`}
          sub="Among closed in window"
        />
        <MetricCard
          label="Avg time to close"
          value={
            analytics.avgTimeToCloseDays == null
              ? "—"
              : `${analytics.avgTimeToCloseDays}d`
          }
          sub="From sent to accepted"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Status breakdown */}
        <Card>
          <CardHeader>
            <CardTitle>Status breakdown</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {analytics.statusBreakdown.length === 0 ? (
              <p className="text-sm text-muted-foreground">No quotes yet.</p>
            ) : (
              analytics.statusBreakdown.map((s) => (
                <div key={s.status} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2">
                      <StatusBadge status={s.status} />
                      <span className="text-muted-foreground">{s.count}</span>
                    </div>
                    <span className="tabular-nums">
                      {formatCurrency(s.value)}
                    </span>
                  </div>
                  <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                    <div
                      className="h-full bg-primary"
                      style={{
                        width: `${(s.value / maxStatusValue) * 100}%`,
                      }}
                    />
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        {/* Top clients */}
        <Card>
          <CardHeader>
            <CardTitle>Top clients (last {analytics.windowDays}d)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {analytics.topClients.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No accepted quotes in this window yet.
              </p>
            ) : (
              analytics.topClients.map((c) => (
                <div key={c.clientId} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <Link
                      href={`/clients/${c.clientId}`}
                      className="font-medium hover:text-primary hover:underline"
                    >
                      {c.clientName}
                    </Link>
                    <span className="tabular-nums">
                      {formatCurrency(c.acceptedTotal)}
                    </span>
                  </div>
                  <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                    <div
                      className="h-full bg-emerald-500"
                      style={{
                        width: `${(c.acceptedTotal / maxClientValue) * 100}%`,
                      }}
                    />
                  </div>
                  <p className="text-[10px] text-muted-foreground">
                    {c.acceptedCount} accepted quote
                    {c.acceptedCount === 1 ? "" : "s"}
                  </p>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      {/* Expiring soon */}
      {analytics.expiringSoon.length > 0 && (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle>Expiring or expired</CardTitle>
            <p className="text-xs text-muted-foreground mt-1">
              Quotes still open whose validUntil is in the next 7 days or
              has already passed.
            </p>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3 text-left font-medium">Number</th>
                    <th className="px-4 py-3 text-left font-medium">Title</th>
                    <th className="px-4 py-3 text-left font-medium">Client</th>
                    <th className="px-4 py-3 text-right font-medium">Total</th>
                    <th className="px-4 py-3 text-left font-medium">
                      Valid until
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {analytics.expiringSoon.map((q) => (
                    <tr
                      key={q.id}
                      className="border-t border-border hover:bg-muted/40 transition-colors"
                    >
                      <td className="px-4 py-3 font-mono text-xs">
                        <Link
                          href={`/quotes/${q.id}`}
                          className="hover:underline"
                        >
                          {q.quoteNumber}
                        </Link>
                      </td>
                      <td className="px-4 py-3">{q.title}</td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {q.clientName}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {formatCurrency(q.total, q.currency)}
                      </td>
                      <td
                        className={`px-4 py-3 text-xs ${
                          q.daysUntilExpiry < 0
                            ? "text-destructive"
                            : q.daysUntilExpiry < 3
                              ? "text-amber-600"
                              : "text-muted-foreground"
                        }`}
                      >
                        {format(q.validUntil, "MMM d, yyyy")}{" "}
                        {q.daysUntilExpiry < 0
                          ? `· expired ${-q.daysUntilExpiry}d ago`
                          : `· in ${q.daysUntilExpiry}d`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function MetricCard({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub: string;
}) {
  return (
    <Card>
      <CardContent className="p-5">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">
          {label}
        </p>
        <p className="text-2xl font-bold text-foreground mt-1 tabular-nums">
          {value}
        </p>
        <p className="text-xs text-muted-foreground mt-1">{sub}</p>
      </CardContent>
    </Card>
  );
}
