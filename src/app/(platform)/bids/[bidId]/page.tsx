import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireAuth, resolveModulePerms } from "@/lib/permissions";
import { AccessDenied } from "@/components/shared/access-denied";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/shared/status-badge";
import { Badge } from "@/components/ui/badge";
import {
  AlertTriangle,
  CalendarClock,
  ExternalLink as ExternalLinkIcon,
  FolderOpen,
  Globe,
  Building2,
  User,
  Trophy,
} from "lucide-react";
import Link from "next/link";
import { formatCalendarDate } from "@/lib/dates";
import { formatCurrency } from "@/lib/quotes/totals";
import { format } from "date-fns";
import { bidDueState, bidWaitingDays, BID_STALE_HINT_DAYS } from "@/lib/bids";
import { BidActions } from "./bid-actions";
import { StageControls } from "./stage-controls";

interface Props {
  params: Promise<{ bidId: string }>;
}

export default async function BidDetailPage({ params }: Props) {
  const { bidId } = await params;
  const user = await requireAuth();

  const [perms, projectPerms] = await Promise.all([
    resolveModulePerms(user.id, user.role, "bids"),
    resolveModulePerms(user.id, user.role, "projects"),
  ]);
  if (!perms.canView) {
    return (
      <AccessDenied
        module="bids"
        moduleLabel="Bid Pipeline"
        moduleDescription="Procurement portals, open bids, and win/loss history"
      />
    );
  }

  const [bid, portals, clients, users] = await Promise.all([
    db.bidOpportunity.findFirst({
      where: { id: bidId, deletedAt: null },
      include: {
        portal: { select: { id: true, name: true, url: true } },
        owner: { select: { id: true, name: true } },
        client: { select: { id: true, name: true } },
        project: { select: { id: true, name: true, status: true } },
      },
    }),
    perms.canEdit
      ? db.bidPortal.findMany({
          where: { isActive: true },
          select: { id: true, name: true },
          orderBy: { name: "asc" },
        })
      : Promise.resolve([] as { id: string; name: string }[]),
    perms.canEdit
      ? db.client.findMany({
          where: { deletedAt: null },
          select: { id: true, name: true },
          orderBy: { name: "asc" },
        })
      : Promise.resolve([] as { id: string; name: string }[]),
    perms.canEdit
      ? db.user.findMany({
          where: { isActive: true },
          select: { id: true, name: true },
          orderBy: { name: "asc" },
        })
      : Promise.resolve([] as { id: string; name: string }[]),
  ]);
  if (!bid) notFound();

  const now = new Date();
  const dueState = bidDueState(bid, now);
  const waitingDays = bidWaitingDays(bid, now);

  return (
    <div>
      <PageHeader
        title={bid.title}
        description={[bid.agency, bid.solicitationNumber].filter(Boolean).join(" · ") || undefined}
        actions={
          <BidActions
            bid={{
              id: bid.id,
              title: bid.title,
              solicitationNumber: bid.solicitationNumber,
              agency: bid.agency,
              url: bid.url,
              description: bid.description,
              estimatedValue: bid.estimatedValue,
              status: bid.status,
              dueDate: bid.dueDate ? bid.dueDate.toISOString() : null,
              portalId: bid.portalId,
              clientId: bid.clientId,
              ownerId: bid.ownerId,
              lossReason: bid.lossReason,
              notes: bid.notes,
            }}
            portals={portals}
            clients={clients}
            users={users}
            canEdit={perms.canEdit}
            canDelete={perms.canDelete}
          />
        }
      />

      <div className="flex items-center gap-3 mb-6 flex-wrap">
        <StatusBadge status={bid.status} />
        {dueState === "overdue" && (
          <Badge variant="destructive" className="gap-1">
            <AlertTriangle className="h-3 w-3" /> Response overdue
          </Badge>
        )}
        {dueState === "due-soon" && (
          <Badge variant="warning" className="gap-1">
            <CalendarClock className="h-3 w-3" /> Due soon
          </Badge>
        )}
        {waitingDays != null && waitingDays >= BID_STALE_HINT_DAYS && (
          <Badge variant="warning" className="gap-1">
            Waiting {waitingDays}d — check on this
          </Badge>
        )}
        {bid.project && (
          <Badge variant="success" className="gap-1">
            <Trophy className="h-3 w-3" /> Converted
          </Badge>
        )}
      </div>

      <div className="mb-6">
        <StageControls
          bid={{
            id: bid.id,
            title: bid.title,
            status: bid.status,
            clientId: bid.clientId,
            projectId: bid.projectId,
          }}
          clients={clients}
          canEdit={perms.canEdit}
          canCreateProject={projectPerms.canCreate}
        />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-6">
          {bid.description && (
            <Card>
              <CardHeader><CardTitle>Scope / summary</CardTitle></CardHeader>
              <CardContent>
                <p className="text-sm whitespace-pre-wrap">{bid.description}</p>
              </CardContent>
            </Card>
          )}
          {bid.lossReason && (
            <Card>
              <CardHeader><CardTitle>Loss reason</CardTitle></CardHeader>
              <CardContent>
                <p className="text-sm whitespace-pre-wrap">{bid.lossReason}</p>
              </CardContent>
            </Card>
          )}
          {bid.notes && (
            <Card>
              <CardHeader><CardTitle>Notes</CardTitle></CardHeader>
              <CardContent>
                <p className="text-sm whitespace-pre-wrap">{bid.notes}</p>
              </CardContent>
            </Card>
          )}
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader><CardTitle>Details</CardTitle></CardHeader>
            <CardContent>
              <div className="space-y-3 text-sm">
                {bid.estimatedValue != null && (
                  <p className="text-muted-foreground">
                    Est. value:{" "}
                    <span className="text-foreground font-medium">
                      {formatCurrency(bid.estimatedValue, bid.currency ?? "USD")}
                    </span>
                  </p>
                )}
                {bid.dueDate && (
                  <p className="flex items-center gap-2 text-muted-foreground">
                    <CalendarClock className="h-4 w-4" />
                    Response due {formatCalendarDate(bid.dueDate, "MMM d, yyyy")}
                  </p>
                )}
                {bid.submittedAt && (
                  <p className="text-muted-foreground">
                    Submitted {format(bid.submittedAt, "MMM d, yyyy")}
                  </p>
                )}
                {bid.decidedAt && (
                  <p className="text-muted-foreground">
                    Decided {format(bid.decidedAt, "MMM d, yyyy")}
                  </p>
                )}
                {bid.portal && (
                  <p className="flex items-center gap-2 text-muted-foreground">
                    <Globe className="h-4 w-4" />
                    {bid.portal.url ? (
                      <a
                        href={bid.portal.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="hover:text-primary hover:underline"
                      >
                        {bid.portal.name}
                      </a>
                    ) : (
                      bid.portal.name
                    )}
                  </p>
                )}
                {bid.url && (
                  <p className="flex items-center gap-2 text-muted-foreground">
                    <ExternalLinkIcon className="h-4 w-4" />
                    <a
                      href={bid.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="hover:text-primary hover:underline"
                    >
                      Open solicitation
                    </a>
                  </p>
                )}
                {bid.owner && (
                  <p className="flex items-center gap-2 text-muted-foreground">
                    <User className="h-4 w-4" />
                    <Link href={`/team/${bid.owner.id}`} className="hover:text-primary hover:underline">
                      {bid.owner.name}
                    </Link>
                  </p>
                )}
                {bid.client && (
                  <p className="flex items-center gap-2 text-muted-foreground">
                    <Building2 className="h-4 w-4" />
                    <Link href={`/clients/${bid.client.id}`} className="hover:text-primary hover:underline">
                      {bid.client.name}
                    </Link>
                  </p>
                )}
                {bid.project && (
                  <p className="flex items-center gap-2 text-muted-foreground">
                    <FolderOpen className="h-4 w-4" />
                    <Link href={`/projects/${bid.project.id}`} className="hover:text-primary hover:underline">
                      {bid.project.name}
                    </Link>
                  </p>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
