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
  FileSignature,
  FolderOpen,
  Globe,
  Building2,
  HelpCircle,
  Moon,
  User,
  Trophy,
} from "lucide-react";
import Link from "next/link";
import { formatCalendarDate } from "@/lib/dates";
import { formatCurrency } from "@/lib/quotes/totals";
import { format } from "date-fns";
import {
  bidDueState,
  bidStaleness,
  bidWaitingDays,
  BID_STALE_HINT_DAYS,
  BID_STATUS_LABELS,
} from "@/lib/bids";
import { BidActions } from "./bid-actions";
import { StageControls } from "./stage-controls";
import { BidAttachments } from "./bid-attachments";
import { EvidenceLinks } from "@/components/shared/evidence-links";
import { LinkContractNudge } from "./link-contract-nudge";
import { ContactLinksCard } from "@/components/shared/contact-links-card";
import { CommentSection } from "@/components/shared/comment-section";

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

  // Bid first — the contract picker below is filtered to its client.
  const bid = await db.bidOpportunity.findFirst({
    where: { id: bidId, deletedAt: null },
    include: {
      portal: { select: { id: true, name: true, url: true } },
      owner: { select: { id: true, name: true } },
      client: { select: { id: true, name: true } },
      endClient: { select: { id: true, name: true } },
      contract: { select: { id: true, title: true, status: true } },
      project: { select: { id: true, name: true, status: true } },
      links: { orderBy: { createdAt: "desc" } },
      comments: {
        include: { author: { select: { id: true, name: true } } },
        orderBy: { createdAt: "desc" },
      },
      files: {
        where: { category: "attachment" },
        include: { uploadedBy: { select: { name: true } } },
        orderBy: { createdAt: "desc" },
      },
    },
  });
  if (!bid) notFound();

  const [portals, clients, users, contracts] = await Promise.all([
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
    // Contract picker options — the bid's client when set, else all.
    perms.canEdit
      ? db.contract.findMany({
          where: { deletedAt: null, ...(bid.clientId ? { clientId: bid.clientId } : {}) },
          select: { id: true, title: true, projectId: true },
          orderBy: { title: "asc" },
        })
      : Promise.resolve([] as { id: string; title: string; projectId: string | null }[]),
  ]);

  // Contracts already on the bid's converted project are the likeliest
  // match — surface them first in both the nudge and the edit picker.
  const fromBidProject = (c: { projectId: string | null }) =>
    bid.projectId != null && c.projectId === bid.projectId;
  const contractOptions = [...contracts]
    .sort((a, b) => Number(fromBidProject(b)) - Number(fromBidProject(a)))
    .map((c) => ({
      id: c.id,
      name: fromBidProject(c) ? `${c.title} (this bid's project)` : c.title,
    }));

  const now = new Date();
  const dueState = bidDueState(bid, now);
  const staleness = bidStaleness(bid, now);
  const waitingDays = bidWaitingDays(bid, now);

  const hasOutcomeFacts =
    bid.submittedAt != null ||
    bid.decidedAt != null ||
    bid.lossReason != null ||
    bid.incumbent != null ||
    bid.endClient != null ||
    bid.contract != null ||
    bid.project != null;

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
              incumbent: bid.incumbent,
              endClientId: bid.endClientId,
              contractId: bid.contractId,
              notes: bid.notes,
              sourceNotes: bid.sourceNotes,
              openQuestions: bid.openQuestions,
            }}
            portals={portals}
            clients={clients}
            users={users}
            contracts={contractOptions}
            canEdit={perms.canEdit}
            canDelete={perms.canDelete}
          />
        }
      />

      <div className="flex items-center gap-3 mb-6 flex-wrap">
        <StatusBadge status={bid.status} />
        {staleness === "stale" ? (
          // Long-past due date on a bid that never moved: not a to-do
          // any more — nudge toward marking it stale (or reviving it).
          <Badge variant="outline" className="gap-1 text-muted-foreground">
            <Moon className="h-3 w-3" /> Gone stale — mark it or revive it
          </Badge>
        ) : (
          dueState === "overdue" && (
            <Badge variant="destructive" className="gap-1">
              <AlertTriangle className="h-3 w-3" /> Response overdue
            </Badge>
          )
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
          {bid.notes && (
            <Card>
              <CardHeader><CardTitle>Notes</CardTitle></CardHeader>
              <CardContent>
                <p className="text-sm whitespace-pre-wrap">{bid.notes}</p>
              </CardContent>
            </Card>
          )}
          {bid.openQuestions && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <HelpCircle className="h-4 w-4 text-warning" /> Open questions
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm whitespace-pre-wrap">{bid.openQuestions}</p>
              </CardContent>
            </Card>
          )}
          {bid.sourceNotes && (
            <Card>
              <CardHeader><CardTitle>Source notes</CardTitle></CardHeader>
              <CardContent>
                <p className="text-sm whitespace-pre-wrap text-muted-foreground">{bid.sourceNotes}</p>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader><CardTitle>Activity & comments</CardTitle></CardHeader>
            <CardContent>
              <CommentSection
                comments={bid.comments}
                entityType="bid"
                entityId={bid.id}
                canComment={perms.canComment}
                canDelete={perms.canDelete}
                currentUserId={user.id}
              />
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader><CardTitle>Outcome</CardTitle></CardHeader>
            <CardContent>
              <div className="space-y-3 text-sm">
                {!hasOutcomeFacts && (
                  <p className="text-muted-foreground">
                    Still in play — nothing submitted or decided yet.
                  </p>
                )}
                {bid.submittedAt && (
                  <p className="text-muted-foreground">
                    Submitted{" "}
                    <span className="text-foreground font-medium">
                      {format(bid.submittedAt, "MMM d, yyyy")}
                    </span>
                  </p>
                )}
                {bid.decidedAt && (
                  <p className="text-muted-foreground">
                    Decided{" "}
                    <span className="text-foreground font-medium">
                      {format(bid.decidedAt, "MMM d, yyyy")}
                    </span>{" "}
                    · {BID_STATUS_LABELS[bid.status]}
                  </p>
                )}
                {bid.lossReason && (
                  <div>
                    <p className="text-muted-foreground">Loss reason</p>
                    <p className="whitespace-pre-wrap">{bid.lossReason}</p>
                  </div>
                )}
                {bid.incumbent && (
                  <p className="text-muted-foreground">
                    Incumbent: <span className="text-foreground">{bid.incumbent}</span>
                  </p>
                )}
                {bid.endClient && (
                  <p className="flex items-center gap-2 text-muted-foreground">
                    <Building2 className="h-4 w-4" />
                    End client:{" "}
                    <Link
                      href={`/clients/${bid.endClient.id}`}
                      className="text-foreground hover:text-primary hover:underline"
                    >
                      {bid.endClient.name}
                    </Link>
                  </p>
                )}
                {bid.contract && (
                  <p className="flex items-center gap-2 text-muted-foreground">
                    <FileSignature className="h-4 w-4" />
                    Contract:{" "}
                    <Link
                      href={`/contracts/${bid.contract.id}`}
                      className="text-foreground hover:text-primary hover:underline"
                    >
                      {bid.contract.title}
                    </Link>
                  </p>
                )}
                {bid.project && (
                  <p className="flex items-center gap-2 text-muted-foreground">
                    <FolderOpen className="h-4 w-4" />
                    Project:{" "}
                    <Link
                      href={`/projects/${bid.project.id}`}
                      className="text-foreground hover:text-primary hover:underline"
                    >
                      {bid.project.name}
                    </Link>
                  </p>
                )}
                {bid.status === "WON" && !bid.contract && perms.canEdit && (
                  <LinkContractNudge bidId={bid.id} contracts={contractOptions} />
                )}
              </div>
            </CardContent>
          </Card>

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
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Evidence & links ({bid.links.length})</CardTitle></CardHeader>
            <CardContent>
              <EvidenceLinks
                entityType="bid"
                entityId={bid.id}
                addDescriptionPlaceholder="Why this link matters for the bid record"
                links={bid.links.map((link) => ({
                  id: link.id,
                  title: link.title,
                  url: link.url,
                  description: link.description,
                  source: link.source,
                }))}
                canEdit={perms.canEdit}
                canDelete={perms.canDelete}
              />
            </CardContent>
          </Card>

          {/* Who we're dealing with on this pursuit — procurement
              officer, buyer, prime's capture lead. Same rolodex card as
              every other entity page. */}
          <ContactLinksCard entityType="bid" entityId={bid.id} title="People" />

          <Card>
            <CardHeader><CardTitle>Attachments ({bid.files.length})</CardTitle></CardHeader>
            <CardContent>
              <BidAttachments
                bidId={bid.id}
                files={bid.files.map((file) => ({
                  id: file.id,
                  name: file.name,
                  url: file.url,
                  size: file.size,
                  createdAt: file.createdAt.toISOString(),
                  uploadedByName: file.uploadedBy?.name ?? null,
                  uploadedById: file.uploadedById,
                }))}
                canUpload={perms.canUpload}
                canDelete={perms.canDelete}
                currentUserId={user.id}
              />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
