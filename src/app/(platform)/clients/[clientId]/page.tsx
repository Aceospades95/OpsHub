import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireAuth, resolveModulePerms } from "@/lib/permissions";
import { getUserScope, canViewEntity } from "@/lib/scope";
import { AccessDenied } from "@/components/shared/access-denied";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/shared/status-badge";
import { CommentSection } from "@/components/shared/comment-section";
import { Badge } from "@/components/ui/badge";
import { Avatar } from "@/components/ui/avatar";
import { Globe, Mail, Phone, Star, CheckSquare, Clock, UserCircle, Target } from "lucide-react";
import { formatCalendarDate } from "@/lib/dates";
import Link from "next/link";
import { ClientActions } from "./client-actions";
import { ContactLinksCard } from "@/components/shared/contact-links-card";
import { EvidenceLinks } from "@/components/shared/evidence-links";
import { effectiveContractStatus } from "@/lib/effective-status";
import { PageLayout } from "@/components/shared/page-layout";
import { TaskCheckbox } from "@/app/(platform)/tasks/task-checkbox";
import { AddTaskButton } from "@/components/shared/add-task-button";
import { RecentlyViewedTracker } from "@/components/shared/recently-viewed-tracker";
import { QuotesCard } from "@/components/quotes/quotes-card";
import { canSeeAllQuotes } from "@/lib/quotes/access";
import { pluralize } from "@/lib/pluralize";

interface Props {
  params: Promise<{ clientId: string }>;
}

export default async function ClientDetailPage({ params }: Props) {
  const { clientId } = await params;
  const user = await requireAuth();

  const perms = await resolveModulePerms(user.id, user.role, "clients");
  if (!perms.canView) return <AccessDenied module="clients" moduleLabel="Clients" moduleDescription="Client accounts, contacts, and relationships" />;

  // Quotes and contracts module visibility is independent of clients — gate
  // the embedded cards on those modules' permissions, not the clients ones.
  // A field-tier user assigned to one of this client's projects can open
  // the client page for contact info but must not see contract values.
  const [quotePerms, contractPerms, taskPerms, bidPerms] = await Promise.all([
    resolveModulePerms(user.id, user.role, "quotes"),
    resolveModulePerms(user.id, user.role, "contracts"),
    resolveModulePerms(user.id, user.role, "tasks"),
    resolveModulePerms(user.id, user.role, "bids"),
  ]);

  // Round-8 QA: resolve by slug-or-id so /clients/<slug> works for
  // new records (where the slug is the canonical href) and existing
  // cuid bookmarks keep resolving for older rows.
  const client = await db.client.findFirst({
    where: {
      OR: [{ id: clientId }, { slug: clientId }],
      deletedAt: null,
    },
    include: {
      accountManager: { select: { id: true, name: true } },
      // Evidence links (the Gmail thread / Drive folder / award page a
      // record's facts came from). People now come from the unified
      // Contact rolodex — the legacy ClientContact include is gone.
      links: { orderBy: { createdAt: "desc" } },
      projects: {
        where: { deletedAt: null },
        include: {
          _count: { select: { members: true, childProjects: true } },
        },
        orderBy: { updatedAt: "desc" },
      },
      contracts: { where: { deletedAt: null }, orderBy: { updatedAt: "desc" } },
      bids: {
        where: { deletedAt: null },
        orderBy: { updatedAt: "desc" },
        take: 8,
        include: { portal: { select: { name: true } } },
      },
      comments: {
        include: { author: { select: { id: true, name: true } } },
        orderBy: { createdAt: "desc" },
      },
    },
  });

  if (!client) notFound();

  const scope = await getUserScope(user.id, user.role);
  if (!canViewEntity(scope, "client", client.id)) {
    return <AccessDenied module="clients" moduleLabel="Clients" entityType="client" entityId={client.id} />;
  }

  // Get tasks associated with this client
  const tasks = await db.task.findMany({
    where: { clientId: client.id, status: { in: ["TODO", "IN_PROGRESS"] }, deletedAt: null },
    orderBy: [{ priority: "asc" }, { dueDate: "asc" }],
    include: { assignee: { select: { id: true, name: true } } },
    take: 10,
  });

  const users = await db.user.findMany({
    where: { isActive: true },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  const canEditLayout = user.role === "ADMIN" || user.role === "DEVELOPER";

  const cardMap: Record<string, React.ReactNode> = {
    "client-info": (
      <div className="h-full space-y-4">
        {client.summary && (
          <Card>
            <CardHeader>
              <CardTitle>Summary</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground whitespace-pre-wrap">{client.summary}</p>
            </CardContent>
          </Card>
        )}

        {(client.sourceNotes || client.openQuestions) && (
          <Card className="mb-6">
            <CardHeader>
              <CardTitle>Provenance &amp; open questions</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {client.sourceNotes && (
                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">
                    Source
                  </p>
                  <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                    {client.sourceNotes}
                  </p>
                </div>
              )}
              {client.openQuestions && (
                <div>
                  <p className="text-xs font-semibold text-warning uppercase tracking-wide mb-1">
                    Open questions / risks
                  </p>
                  <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                    {client.openQuestions}
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        )}
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center gap-3 mb-4">
              <StatusBadge status={client.status} />
              {client.industry && <Badge variant="outline">{client.industry}</Badge>}
            </div>
            {client.website && (
              <a
                href={client.website}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
              >
                <Globe className="h-3 w-3" />
                {client.website}
              </a>
            )}
          </CardContent>
        </Card>
      </div>
    ),
    projects: (
      <Card className="h-full">
        <CardHeader>
          <CardTitle>Projects ({client.projects.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {client.projects.length === 0 ? (
            <div className="text-sm text-muted-foreground">
              No projects yet.{" "}
              {perms.canCreate && (
                <Link href={`/projects?clientId=${client.id}`} className="text-primary hover:underline">
                  Create the first project →
                </Link>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              {client.projects.map((project) => (
                <Link
                  key={project.id}
                  href={`/projects/${project.id}`}
                  className="flex items-center justify-between rounded border border-border bg-muted p-3 hover:border-primary transition-colors"
                >
                  <div>
                    <p className="font-medium text-sm">{project.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {pluralize(project._count.members, "member")}
                      {project._count.childProjects > 0 && ` · ${pluralize(project._count.childProjects, "sub-project")}`}
                    </p>
                  </div>
                  <StatusBadge status={project.status} />
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    ),
    contracts: contractPerms.canView ? (
      <Card className="h-full">
        <CardHeader>
          <CardTitle>Contracts ({client.contracts.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {client.contracts.length === 0 ? (
            <div className="text-sm text-muted-foreground">
              No contracts yet.{" "}
              {perms.canCreate && (
                <Link href={`/contracts?client=${client.id}`} className="text-primary hover:underline">
                  Create one →
                </Link>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              {client.contracts.map((contract) => (
                <Link
                  key={contract.id}
                  href={`/contracts/${contract.id}`}
                  className="flex items-center justify-between rounded border border-border bg-muted p-3 hover:border-primary transition-colors"
                >
                  <div>
                    <p className="font-medium text-sm">{contract.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {contract.contractType && `${contract.contractType} · `}
                      {contract.value
                        ? `${contract.currency || "USD"} ${contract.value.toLocaleString()}`
                        : "No value set"}
                    </p>
                  </div>
                  {/* Date-derived — the stored enum lags the calendar. */}
                  <StatusBadge status={effectiveContractStatus(contract, new Date())} />
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    ) : null,
    comments: (
      <Card className="h-full">
        <CardHeader>
          <CardTitle>Comments</CardTitle>
        </CardHeader>
        <CardContent>
          <CommentSection
            comments={client.comments}
            entityType="client"
            entityId={client.id}
            canComment={perms.canComment}
            canDelete={perms.canDelete}
            currentUserId={user.id}
          />
        </CardContent>
      </Card>
    ),
    contacts: (
      <div className="h-full space-y-4">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <UserCircle className="h-4 w-4" />
              Account Manager
            </CardTitle>
          </CardHeader>
          <CardContent>
            {client.accountManager ? (
              <Link href={`/team/${client.accountManager.id}`} className="flex items-center gap-3 hover:text-primary">
                <Avatar name={client.accountManager.name || "?"} size="sm" />
                <span className="text-sm font-medium hover:underline">{client.accountManager.name}</span>
              </Link>
            ) : (
              <p className="text-sm text-muted-foreground">Not assigned</p>
            )}
          </CardContent>
        </Card>
        {/* Unified rolodex (Contact/ContactLink) — the legacy
            ClientContact card is retired; those rows were backfilled
            into the rolodex by the crm_contacts migration. */}
        <ContactLinksCard entityType="client" entityId={client.id} />
      </div>
    ),
    links: (
      <Card className="h-full">
        <CardHeader>
          <CardTitle>Evidence &amp; links ({client.links.length})</CardTitle>
        </CardHeader>
        <CardContent>
          <EvidenceLinks
            entityType="client"
            entityId={client.id}
            addDescriptionPlaceholder="Where these facts came from — thread, folder, award page"
            links={client.links.map((link) => ({
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
    ),
    quotes: quotePerms.canView ? (
      <QuotesCard
        clientId={client.id}
        canCreate={quotePerms.canCreate}
        restrictToUserId={canSeeAllQuotes(user.role) ? undefined : user.id}
      />
    ) : null,
    bids: bidPerms.canView ? (
      <Card className="h-full">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <Target className="h-4 w-4" />
              Bids
            </CardTitle>
            <Link href="/bids" className="text-xs text-primary hover:underline">
              View pipeline
            </Link>
          </div>
        </CardHeader>
        <CardContent>
          {client.bids.length === 0 ? (
            <p className="text-sm text-muted-foreground">No bids tracked for this client.</p>
          ) : (
            <div className="space-y-2">
              {client.bids.map((bid) => (
                <Link
                  key={bid.id}
                  href={`/bids/${bid.id}`}
                  className="flex items-center justify-between gap-2 rounded border border-border bg-muted p-2.5 hover:border-primary transition-colors"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{bid.title}</p>
                    <p className="text-xs text-muted-foreground truncate">
                      {[bid.portal?.name, bid.dueDate ? `due ${formatCalendarDate(bid.dueDate, "MMM d")}` : null]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  </div>
                  <StatusBadge status={bid.status} />
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    ) : null,
    tasks: (
      <Card className="h-full">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <CheckSquare className="h-4 w-4" />
              Tasks
            </CardTitle>
            <div className="flex items-center gap-3">
              {taskPerms.canCreate && (
                <AddTaskButton
                  clientId={client.id}
                  users={users.map((u) => ({ id: u.id, name: u.name }))}
                />
              )}
              <Link href={`/tasks?client=${client.id}`} className="text-xs text-primary hover:underline">
                View all
              </Link>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {tasks.length === 0 ? (
            <div className="text-sm text-muted-foreground">
              No open tasks.{" "}
              <Link href={`/tasks?client=${client.id}`} className="text-primary hover:underline">
                Add a task →
              </Link>
            </div>
          ) : (
            <div className="space-y-2">
              {tasks.map((task) => (
                <div key={task.id} className="flex items-start gap-3 text-sm">
                  <TaskCheckbox taskId={task.id} status={task.status} />
                  <div className="min-w-0 flex-1">
                    <p className={`font-medium truncate ${task.status === "DONE" ? "line-through text-muted-foreground" : ""}`}>{task.title}</p>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      {task.assignee && (
                        <Link href={`/team/${task.assignee.id}`} className="hover:text-primary hover:underline">
                          {task.assignee.name}
                        </Link>
                      )}
                      {task.dueDate && (
                        <span className={`flex items-center gap-1 ${new Date(task.dueDate) < new Date() ? "text-destructive" : ""}`}>
                          <Clock className="h-3 w-3" />
                          {formatCalendarDate(task.dueDate, "MMM d")}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    ),
  };

  return (
    <div>
      <RecentlyViewedTracker
        type="client"
        id={client.id}
        label={client.name}
        sublabel={client.industry || undefined}
        href={`/clients/${client.id}`}
      />
      <PageHeader
        title={client.name}
        description={client.description || undefined}
        actions={
          <ClientActions
            client={client}
            users={users}
            canEdit={perms.canEdit}
            canDelete={perms.canDelete}
          />
        }
      />

      <PageLayout pageType="client-detail" cards={cardMap} canEdit={canEditLayout} mode="flow" />
    </div>
  );
}
