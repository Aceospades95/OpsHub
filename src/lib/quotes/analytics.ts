/**
 * Quote pipeline analytics.
 *
 * Pure DB queries used by the /quotes/analytics page and (in part) by
 * the daily reminder digest. Centralized here so both consumers agree
 * on the definitions of "open value", "win rate", and "time to close".
 */

import { db } from "@/lib/db";

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

export interface QuoteAnalytics {
  /** Sum of total on every quote in DRAFT/SENT/VIEWED status — what's
   *  on the table waiting for client action. */
  openPipelineValue: number;
  openCount: number;
  /** Sum of total on quotes that ACCEPTED in the trailing window. */
  acceptedValue: number;
  acceptedCount: number;
  /** Win rate as a percentage 0-100 over the closed (accepted +
   *  rejected + expired) population in the window. Null when nothing
   *  closed during the window. */
  winRate: number | null;
  /** Average days from sentAt to acceptedAt for quotes that accepted
   *  in the window. Null when no quotes accepted. */
  avgTimeToCloseDays: number | null;
  /** Per-status breakdown — drives the funnel chart. */
  statusBreakdown: Array<{ status: string; count: number; value: number }>;
  /** Top clients by accepted total value in the window. */
  topClients: Array<{
    clientId: string;
    clientName: string;
    acceptedTotal: number;
    acceptedCount: number;
  }>;
  /** Quotes whose validUntil is within the next 7 days OR is already
   *  expired but the quote is still open. */
  expiringSoon: Array<{
    id: string;
    quoteNumber: string;
    title: string;
    clientName: string;
    total: number;
    currency: string;
    validUntil: Date;
    daysUntilExpiry: number;
  }>;
  /** Window used to compute the rate metrics (in days). */
  windowDays: number;
}

export async function getQuoteAnalytics(
  windowDays: number = 90,
  now: Date = new Date()
): Promise<QuoteAnalytics> {
  const since = new Date(now.getTime() - windowDays * ONE_DAY_MS);

  const [
    openAgg,
    acceptedAgg,
    closedAggCount,
    acceptedWithDuration,
    statusBreakdownRaw,
    topClientsRaw,
    expiringRaw,
  ] = await Promise.all([
    db.quote.aggregate({
      where: { status: { in: ["DRAFT", "SENT", "VIEWED"] } },
      _sum: { total: true },
      _count: { _all: true },
    }),
    db.quote.aggregate({
      where: { status: "ACCEPTED", acceptedAt: { gte: since } },
      _sum: { total: true },
      _count: { _all: true },
    }),
    db.quote.count({
      where: {
        OR: [
          { status: "ACCEPTED", acceptedAt: { gte: since } },
          { status: "REJECTED", rejectedAt: { gte: since } },
          { status: "EXPIRED", validUntil: { gte: since } },
        ],
      },
    }),
    db.quote.findMany({
      where: { status: "ACCEPTED", acceptedAt: { gte: since } },
      select: { sentAt: true, acceptedAt: true },
    }),
    db.quote.groupBy({
      by: ["status"],
      _count: { _all: true },
      _sum: { total: true },
    }),
    db.quote.groupBy({
      by: ["clientId"],
      where: { status: "ACCEPTED", acceptedAt: { gte: since } },
      _sum: { total: true },
      _count: { _all: true },
      orderBy: { _sum: { total: "desc" } },
      take: 5,
    }),
    db.quote.findMany({
      where: {
        status: { in: ["DRAFT", "SENT", "VIEWED", "EXPIRED"] },
        validUntil: { not: null, lte: new Date(now.getTime() + 7 * ONE_DAY_MS) },
      },
      include: { client: { select: { name: true } } },
      orderBy: { validUntil: "asc" },
      take: 20,
    }),
  ]);

  const acceptedCount = acceptedAgg._count._all;
  const closedCount = closedAggCount;
  const winRate =
    closedCount > 0 ? Math.round((acceptedCount / closedCount) * 100) : null;

  const avgTimeToCloseDays = (() => {
    const usable = acceptedWithDuration.filter(
      (q) => q.sentAt != null && q.acceptedAt != null
    );
    if (usable.length === 0) return null;
    const sumDays = usable.reduce((acc, q) => {
      const days =
        ((q.acceptedAt as Date).getTime() - (q.sentAt as Date).getTime()) /
        ONE_DAY_MS;
      return acc + days;
    }, 0);
    return Math.round((sumDays / usable.length) * 10) / 10;
  })();

  const statusBreakdown = statusBreakdownRaw.map((row) => ({
    status: row.status,
    count: row._count._all,
    value: row._sum.total ?? 0,
  }));

  // Resolve client names for the top-clients chart.
  const topClientIds = topClientsRaw.map((c) => c.clientId);
  const clients =
    topClientIds.length > 0
      ? await db.client.findMany({
          where: { id: { in: topClientIds } },
          select: { id: true, name: true },
        })
      : [];
  const clientNameMap = new Map(clients.map((c) => [c.id, c.name]));
  const topClients = topClientsRaw.map((c) => ({
    clientId: c.clientId,
    clientName: clientNameMap.get(c.clientId) ?? "(missing client)",
    acceptedTotal: c._sum.total ?? 0,
    acceptedCount: c._count._all,
  }));

  const expiringSoon = expiringRaw
    .filter((q) => q.validUntil != null)
    .map((q) => ({
      id: q.id,
      quoteNumber: q.quoteNumber,
      title: q.title,
      clientName: q.client.name,
      total: q.total,
      currency: q.currency,
      validUntil: q.validUntil!,
      daysUntilExpiry: Math.floor(
        ((q.validUntil as Date).getTime() - now.getTime()) / ONE_DAY_MS
      ),
    }));

  return {
    openPipelineValue: openAgg._sum.total ?? 0,
    openCount: openAgg._count._all,
    acceptedValue: acceptedAgg._sum.total ?? 0,
    acceptedCount,
    winRate,
    avgTimeToCloseDays,
    statusBreakdown,
    topClients,
    expiringSoon,
    windowDays,
  };
}
