import { db } from "@/lib/db";
import Link from "next/link";
import { Suspense } from "react";
import { format } from "date-fns";
import { ReceiptText } from "lucide-react";

import { requireAuth, resolveModulePerms } from "@/lib/permissions";
import { AccessDenied } from "@/components/shared/access-denied";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusBadge } from "@/components/shared/status-badge";
import { formatCurrency } from "@/lib/quotes/totals";

import { QuoteCreateButton } from "./quote-create-button";
import { QuoteFilters } from "./quote-filters";
import { Prisma, QuoteStatus } from "@prisma/client";

const STATUS_VALUES: QuoteStatus[] = [
  "DRAFT",
  "SENT",
  "VIEWED",
  "ACCEPTED",
  "REJECTED",
  "EXPIRED",
  "REVISED",
];

function isStatus(s: string | undefined): s is QuoteStatus {
  return !!s && (STATUS_VALUES as string[]).includes(s);
}

export default async function QuotesPage({
  searchParams,
}: {
  searchParams: { status?: string; q?: string };
}) {
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

  const status = isStatus(searchParams.status) ? searchParams.status : undefined;
  const search = searchParams.q?.trim();

  const where: Prisma.QuoteWhereInput = {};
  if (status) where.status = status;
  if (search) {
    where.OR = [
      { title: { contains: search, mode: "insensitive" } },
      { quoteNumber: { contains: search, mode: "insensitive" } },
      { client: { name: { contains: search, mode: "insensitive" } } },
    ];
  }

  const clients = await db.client.findMany({
    where: { status: { in: ["ACTIVE", "PROSPECT"] } },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  const [quotes, openValueAgg, acceptedLast30Agg, allTimeAgg] = await Promise.all([
    db.quote.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      include: {
        client: { select: { id: true, name: true } },
        project: { select: { id: true, name: true } },
        assignedTo: { select: { id: true, name: true } },
      },
      take: 200,
    }),
    db.quote.aggregate({
      where: { status: { in: ["DRAFT", "SENT", "VIEWED"] } },
      _sum: { total: true },
      _count: { _all: true },
    }),
    db.quote.aggregate({
      where: {
        status: "ACCEPTED",
        acceptedAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
      },
      _sum: { total: true },
      _count: { _all: true },
    }),
    db.quote.aggregate({
      where: { status: { in: ["ACCEPTED", "REJECTED", "EXPIRED"] } },
      _count: { _all: true },
    }),
  ]);

  const acceptedAllTime = await db.quote.count({ where: { status: "ACCEPTED" } });
  const winRate =
    allTimeAgg._count._all > 0
      ? Math.round((acceptedAllTime / allTimeAgg._count._all) * 100)
      : null;

  const metrics = [
    {
      label: "Open quotes",
      value: openValueAgg._count._all.toString(),
      sub: formatCurrency(openValueAgg._sum.total ?? 0),
    },
    {
      label: "Accepted (30d)",
      value: acceptedLast30Agg._count._all.toString(),
      sub: formatCurrency(acceptedLast30Agg._sum.total ?? 0),
    },
    {
      label: "Win rate",
      value: winRate == null ? "—" : `${winRate}%`,
      sub: `${acceptedAllTime}/${allTimeAgg._count._all} closed`,
    },
  ];

  return (
    <div>
      <PageHeader
        title="Quotes"
        description="Build, track, and manage sales quotes and proposals"
        actions={
          <div className="flex items-center gap-2">
            <Link
              href="/quotes/analytics"
              className="text-sm text-muted-foreground hover:text-foreground hover:underline"
            >
              Analytics
            </Link>
            <Link
              href="/quotes/templates"
              className="text-sm text-muted-foreground hover:text-foreground hover:underline"
            >
              Templates
            </Link>
            <Link
              href="/quotes/catalog"
              className="text-sm text-muted-foreground hover:text-foreground hover:underline"
            >
              Catalog
            </Link>
            {perms.canCreate && <QuoteCreateButton clients={clients} />}
          </div>
        }
      />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        {metrics.map((m) => (
          <Card key={m.label}>
            <CardContent className="p-5">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">
                {m.label}
              </p>
              <p className="text-2xl font-bold text-foreground mt-1">{m.value}</p>
              <p className="text-xs text-muted-foreground mt-1">{m.sub}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Suspense fallback={null}>
        <QuoteFilters
          currentStatus={status}
          currentSearch={search}
          resultCount={quotes.length}
        />
      </Suspense>

      {quotes.length === 0 ? (
        <EmptyState
          icon={ReceiptText}
          title="No quotes yet"
          description={
            status || search
              ? "No quotes match the current filter"
              : "Create your first quote to get started"
          }
        />
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3 text-left font-medium">Number</th>
                    <th className="px-4 py-3 text-left font-medium">Title</th>
                    <th className="px-4 py-3 text-left font-medium">Client</th>
                    <th className="px-4 py-3 text-left font-medium">Status</th>
                    <th className="px-4 py-3 text-right font-medium">Total</th>
                    <th className="px-4 py-3 text-left font-medium">Valid until</th>
                    <th className="px-4 py-3 text-left font-medium">Updated</th>
                  </tr>
                </thead>
                <tbody>
                  {quotes.map((q) => (
                    <tr
                      key={q.id}
                      className="border-t border-border hover:bg-muted/40 transition-colors"
                    >
                      <td className="px-4 py-3 font-mono text-xs">
                        <Link href={`/quotes/${q.id}`} className="hover:underline">
                          {q.quoteNumber}
                        </Link>
                      </td>
                      <td className="px-4 py-3">
                        <Link
                          href={`/quotes/${q.id}`}
                          className="font-medium hover:text-primary hover:underline"
                        >
                          {q.title}
                        </Link>
                      </td>
                      <td className="px-4 py-3">
                        <Link
                          href={`/clients/${q.client.id}`}
                          className="text-muted-foreground hover:text-primary hover:underline"
                        >
                          {q.client.name}
                        </Link>
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge status={q.status} />
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {formatCurrency(q.total, q.currency)}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground text-xs">
                        {q.validUntil ? format(q.validUntil, "MMM d, yyyy") : "—"}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground text-xs">
                        {format(q.updatedAt, "MMM d, yyyy")}
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
