import { db } from "@/lib/db";
import { requireAuth, resolveModulePerms } from "@/lib/permissions";
import { AccessDenied } from "@/components/shared/access-denied";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { StatusBadge } from "@/components/shared/status-badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Target, CalendarClock, AlertTriangle, Hourglass, Moon, Trophy, Globe, User } from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { formatCalendarDate } from "@/lib/dates";
import { formatCurrency } from "@/lib/quotes/totals";
import { resolveViewPreference } from "@/lib/view-preference";
import { ViewOptionsBar } from "@/components/shared/view-options-bar";
import { GroupSection } from "@/components/shared/group-section";
import { groupRows } from "@/lib/group-rows";
import {
  BID_STATUSES,
  BID_STATUS_LABELS,
  OPEN_BID_STATUSES,
  bidDueState,
  bidStaleness,
  bidWaitingDays,
  BID_STALE_HINT_DAYS,
  type BidDueState,
  type BidStaleness,
} from "@/lib/bids";
import { BidCreateButton } from "./bid-create-button";
import { BidStaleAction } from "./bid-stale-action";
import type { Prisma } from "@prisma/client";

type BidRow = Prisma.BidOpportunityGetPayload<{
  include: {
    portal: { select: { id: true; name: true } };
    owner: { select: { id: true; name: true } };
    client: { select: { id: true; name: true } };
  };
}>;

const GROUP_OPTIONS = [
  { value: "portal", label: "Portal" },
  { value: "owner", label: "Owner" },
  { value: "client", label: "Client" },
  { value: "agency", label: "Agency" },
] as const;
type GroupKey = (typeof GROUP_OPTIONS)[number]["value"];

const DUE_FILTERS = ["overdue", "due-soon", "stale"] as const;
type DueFilter = (typeof DUE_FILTERS)[number];

export const metadata = { title: "Bids · OpsHub" };

export default async function BidsPage({
  searchParams,
}: {
  searchParams: { view?: string; groupBy?: string; due?: string };
}) {
  const user = await requireAuth();

  const perms = await resolveModulePerms(user.id, user.role, "bids");
  if (!perms.canView) {
    return (
      <AccessDenied
        module="bids"
        moduleLabel="Bid Pipeline"
        moduleDescription="Procurement portals, open bids, and win/loss history"
      />
    );
  }

  // "pipeline" (stage sections, the default) vs flat "table" — same
  // two-view idiom as projects/contracts (tree default + flat table).
  const view = resolveViewPreference(searchParams.view, "bids", ["table", "pipeline"], "pipeline");
  const groupBy = GROUP_OPTIONS.some((o) => o.value === searchParams.groupBy)
    ? (searchParams.groupBy as GroupKey)
    : null;
  const dueFilter = DUE_FILTERS.includes(searchParams.due as DueFilter)
    ? (searchParams.due as DueFilter)
    : null;

  const [bids, portals, clients, users] = await Promise.all([
    db.bidOpportunity.findMany({
      where: { deletedAt: null },
      orderBy: [{ dueDate: { sort: "asc", nulls: "last" } }, { createdAt: "desc" }],
      include: {
        portal: { select: { id: true, name: true } },
        owner: { select: { id: true, name: true } },
        client: { select: { id: true, name: true } },
      },
    }),
    db.bidPortal.findMany({
      where: { isActive: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    perms.canCreate
      ? db.client.findMany({
          where: { deletedAt: null },
          select: { id: true, name: true },
          orderBy: { name: "asc" },
        })
      : Promise.resolve([] as { id: string; name: string }[]),
    perms.canCreate
      ? db.user.findMany({
          where: { isActive: true },
          select: { id: true, name: true },
          orderBy: { name: "asc" },
        })
      : Promise.resolve([] as { id: string; name: string }[]),
  ]);

  const now = new Date();
  const dueStates = new Map<string, BidDueState>(
    bids.map((bid) => [bid.id, bidDueState(bid, now)])
  );
  // Splits "past due" into a real to-do ("overdue", ≤30 days past) vs
  // rows that died quietly ("stale", >30 days past and never left
  // IDENTIFIED/PREPARING) — so last year's bids stop reading as
  // overdue forever.
  const stalenessById = new Map<string, BidStaleness>(
    bids.map((bid) => [bid.id, bidStaleness(bid, now)])
  );

  const openBids = bids.filter((b) => OPEN_BID_STATUSES.includes(b.status));
  const pipelineValue = openBids.reduce((sum, b) => sum + (b.estimatedValue ?? 0), 0);
  const dueSoon = bids.filter((b) => dueStates.get(b.id) === "due-soon");
  const overdue = bids.filter((b) => stalenessById.get(b.id) === "overdue");
  const goneStale = bids.filter((b) => stalenessById.get(b.id) === "stale");
  const awaiting = bids.filter((b) => b.status === "SUBMITTED");
  const won = bids.filter((b) => b.status === "WON");

  const visibleBids = dueFilter
    ? bids.filter((b) =>
        dueFilter === "due-soon"
          ? dueStates.get(b.id) === "due-soon"
          : stalenessById.get(b.id) === dueFilter
      )
    : bids;

  const groupKeyOf = (bid: BidRow, key: GroupKey): string | null => {
    switch (key) {
      case "portal":
        return bid.portal?.name ?? null;
      case "owner":
        return bid.owner?.name ?? null;
      case "client":
        return bid.client?.name ?? null;
      case "agency":
        return bid.agency;
    }
  };

  const dueLine = (bid: BidRow) => {
    const state = dueStates.get(bid.id);
    if (!bid.dueDate) return null;
    const text = `Due ${formatCalendarDate(bid.dueDate, "MMM d, yyyy")}`;
    // Stale rows keep the date but drop the red — it's history, not a
    // deadline anyone is chasing.
    const cls =
      stalenessById.get(bid.id) === "stale"
        ? "text-muted-foreground"
        : state === "overdue"
          ? "text-destructive font-medium"
          : state === "due-soon"
            ? "text-warning font-medium"
            : "text-muted-foreground";
    return <span className={cls}>{text}</span>;
  };

  /** Stale badge + housekeeping affordance for one row. */
  const staleControls = (bid: BidRow) => {
    const isStale = stalenessById.get(bid.id) === "stale";
    return (
      <>
        {isStale && (
          <Badge variant="outline" className="gap-1 text-muted-foreground">
            <Moon className="h-3 w-3" /> Stale
          </Badge>
        )}
        {perms.canEdit && isStale && <BidStaleAction bidId={bid.id} action="mark-stale" />}
        {perms.canEdit && bid.status === "STALE" && (
          <BidStaleAction bidId={bid.id} action="revive" />
        )}
      </>
    );
  };

  const waitingHint = (bid: BidRow) => {
    const days = bidWaitingDays(bid, now);
    if (days == null || days < BID_STALE_HINT_DAYS) return null;
    return (
      <span className="text-warning text-xs font-medium">
        Waiting {days}d — check on this
      </span>
    );
  };

  const renderCard = (bid: BidRow) => (
    <Link key={bid.id} href={`/bids/${bid.id}`}>
      <Card className="hover:shadow-md transition-shadow h-full">
        <CardContent className="p-4 space-y-2">
          <div className="flex items-start justify-between gap-2">
            <p className="font-medium leading-tight">{bid.title}</p>
            <StatusBadge status={bid.status} />
          </div>
          <p className="text-sm text-muted-foreground">
            {[bid.agency, bid.solicitationNumber].filter(Boolean).join(" · ") || "—"}
          </p>
          <div className="flex items-center gap-3 text-sm flex-wrap">
            {bid.estimatedValue != null && (
              <span className="font-medium">{formatCurrency(bid.estimatedValue, bid.currency ?? "USD")}</span>
            )}
            {dueLine(bid)}
            {waitingHint(bid)}
            {staleControls(bid)}
          </div>
          <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
            {bid.portal && (
              <span className="inline-flex items-center gap-1">
                <Globe className="h-3 w-3" /> {bid.portal.name}
              </span>
            )}
            {bid.owner && (
              <span className="inline-flex items-center gap-1">
                <User className="h-3 w-3" /> {bid.owner.name}
              </span>
            )}
            {bid.client && <span>{bid.client.name}</span>}
          </div>
        </CardContent>
      </Card>
    </Link>
  );

  const renderCards = (rows: BidRow[]) => (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {rows.map(renderCard)}
    </div>
  );

  const renderTable = (rows: BidRow[]) => (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-muted text-left text-xs text-muted-foreground">
            <th className="px-3 py-2 font-medium">Title</th>
            <th className="px-3 py-2 font-medium">Agency</th>
            <th className="px-3 py-2 font-medium">Portal</th>
            <th className="px-3 py-2 font-medium text-right">Est. value</th>
            <th className="px-3 py-2 font-medium">Due</th>
            <th className="px-3 py-2 font-medium">Stage</th>
            <th className="px-3 py-2 font-medium">Owner</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((bid) => (
            <tr key={bid.id} className="border-b border-border last:border-0 hover:bg-muted/50">
              <td className="px-3 py-2.5">
                <Link href={`/bids/${bid.id}`} className="font-medium hover:text-primary hover:underline">
                  {bid.title}
                </Link>
                {bid.solicitationNumber && (
                  <span className="ml-2 text-xs text-muted-foreground">{bid.solicitationNumber}</span>
                )}
              </td>
              <td className="px-3 py-2.5 text-muted-foreground">{bid.agency || "—"}</td>
              <td className="px-3 py-2.5 text-muted-foreground">{bid.portal?.name || "—"}</td>
              <td className="px-3 py-2.5 text-right tabular-nums">
                {bid.estimatedValue != null ? formatCurrency(bid.estimatedValue, bid.currency ?? "USD") : "—"}
              </td>
              <td className="px-3 py-2.5 whitespace-nowrap">{dueLine(bid) ?? "—"}</td>
              <td className="px-3 py-2.5">
                <div className="flex items-center gap-2 flex-wrap">
                  <StatusBadge status={bid.status} />
                  {staleControls(bid)}
                </div>
              </td>
              <td className="px-3 py-2.5 text-muted-foreground">{bid.owner?.name || "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  const statChip = (
    label: string,
    value: string,
    href: string,
    icon: React.ReactNode,
    active: boolean,
    opts?: { muted?: boolean }
  ) => (
    <Link
      href={href}
      className={`rounded-lg border p-3 transition-colors ${
        active ? "border-primary bg-primary/5" : "border-border bg-card hover:bg-muted"
      }`}
    >
      <div className="flex items-center gap-2 text-xs text-muted-foreground">{icon}{label}</div>
      <p className={`mt-1 text-xl font-semibold ${opts?.muted ? "text-muted-foreground" : ""}`}>
        {value}
      </p>
    </Link>
  );

  return (
    <div>
      <PageHeader
        title="Bid Pipeline"
        description="Where we find work, what we're chasing, and how it ended up"
        actions={
          <div className="flex items-center gap-2">
            <Link
              href="/bids/portals"
              className="inline-flex h-9 items-center gap-1 rounded-md border border-input bg-background px-3 text-sm font-medium hover:bg-muted"
            >
              <Globe className="h-4 w-4" /> Portals
            </Link>
            {perms.canCreate && <BidCreateButton portals={portals} clients={clients} users={users} />}
          </div>
        }
      />

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6 mb-6">
        {statChip(
          "Open pipeline",
          // Compact ("$48.8M") — the full form wraps a ~126px chip to 3 lines.
          `${openBids.length}${pipelineValue > 0 ? ` · ${formatCurrency(pipelineValue, "USD", { compact: true })}` : ""}`,
          "/bids",
          <Target className="h-3.5 w-3.5" />,
          !dueFilter
        )}
        {statChip("Due ≤ 7 days", String(dueSoon.length), "/bids?due=due-soon", <CalendarClock className="h-3.5 w-3.5" />, dueFilter === "due-soon")}
        {statChip("Overdue", String(overdue.length), "/bids?due=overdue", <AlertTriangle className="h-3.5 w-3.5" />, dueFilter === "overdue")}
        {/* Long-past pre-submission rows — housekeeping, not urgency,
            so the count renders muted and stays out of Overdue. */}
        {statChip("Gone stale", String(goneStale.length), "/bids?due=stale", <Moon className="h-3.5 w-3.5" />, dueFilter === "stale", { muted: true })}
        {statChip("Awaiting decision", String(awaiting.length), "/bids?view=table", <Hourglass className="h-3.5 w-3.5" />, false)}
        {statChip("Won", String(won.length), "/bids?view=table", <Trophy className="h-3.5 w-3.5" />, false)}
      </div>

      <ViewOptionsBar
        view={view === "pipeline" ? undefined : view}
        viewOptions={[
          { value: "pipeline", label: "Pipeline" },
          { value: "table", label: "Table" },
        ]}
        storageKey="bids"
        groupBy={groupBy}
        groupByOptions={view === "table" ? [...GROUP_OPTIONS] : []}
      />

      {visibleBids.length === 0 ? (
        <EmptyState
          icon={Target}
          title={dueFilter ? "Nothing in this window" : "No bids tracked yet"}
          description={
            dueFilter === "stale"
              ? "No bids have gone stale — everything past due is recent enough to still chase."
              : dueFilter
                ? "No open bids match this due-date filter."
                : "Add the opportunities you're evaluating and track them through award."
          }
        />
      ) : view === "pipeline" ? (
        // Stage sections in pipeline order — the board view.
        <div className="space-y-4">
          {BID_STATUSES.map((status) => {
            const rows = visibleBids.filter((b) => b.status === status);
            if (rows.length === 0) return null;
            const stageValue = rows.reduce((sum, b) => sum + (b.estimatedValue ?? 0), 0);
            return (
              <GroupSection
                key={status}
                label={BID_STATUS_LABELS[status]}
                count={rows.length}
                subtitle={stageValue > 0 ? formatCurrency(stageValue, "USD") : undefined}
              >
                {renderCards(rows)}
              </GroupSection>
            );
          })}
        </div>
      ) : groupBy ? (
        <div className="space-y-4">
          {groupRows(visibleBids, (bid) => groupKeyOf(bid, groupBy)).map((group) => (
            <GroupSection key={group.label} label={group.label} count={group.rows.length}>
              {renderTable(group.rows)}
            </GroupSection>
          ))}
        </div>
      ) : (
        renderTable(visibleBids)
      )}
    </div>
  );
}
