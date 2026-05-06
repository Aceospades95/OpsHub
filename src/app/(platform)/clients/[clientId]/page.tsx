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
import { Globe, Mail, Phone, Star, CheckSquare, Clock, UserCircle } from "lucide-react";
import { formatCalendarDate } from "@/lib/dates";
import Link from "next/link";
import { ClientActions } from "./client-actions";
import { ContactSection } from "./contact-section";
import { PageLayout } from "@/components/shared/page-layout";
import { TaskCheckbox } from "@/app/(platform)/tasks/task-checkbox";
import { RecentlyViewedTracker } from "@/components/shared/recently-viewed-tracker";
import { QuotesCard } from "@/components/quotes/quotes-card";

interface Props {
  params: Promise<{ clientId: string }>;
}

export default async function ClientDetailPage({ params }: Props) {
  const { clientId } = await params;
  const user = await requireAuth();

  const perms = await resolveModulePerms(user.id, user.role, "clients");
  if (!perms.canView) return <AccessDenied module="clients" moduleLabel="Clients" moduleDescription="Client accounts, contacts, and relationships" />;

  // Quotes module visibility is independent of clients — gate the embedded
  // card on the user's quotes permissions, not their clients permissions.
  const quotePerms = await resolveModulePerms(user.id, user.role, "quotes");

  const client = await db.client.findUnique({
    where: { id: clientId },
    include: {
      accountManager: { select: { id: true, name: true } },
      contacts: { orderBy: [{ isPrimary: "desc" }, { name: "asc" }] },
      projects: {
        include: {
          _count: { select: { members: true, childProjects: true } },
        },
        orderBy: { updatedAt: "desc" },
      },
      contracts: { orderBy: { updatedAt: "desc" } },
      comments: {
        include: { author: { select: { id: true, name: true } } },
        orderBy: { createdAt: "desc" },
      },
    },
  });

  if (!client) notFound();

  const scope = await getUserScope(user.id, user.role);
  if (!canViewEntity(scope, "client", client.id)) {
    return <AccessDenied module="clients" moduleLabel="Clients" entityType="client" entityId={client.id} entityLabel={client.name} />;
  }

  // Get tasks associated with this client
  const tasks = await db.task.findMany({
    where: { clientId: client.id, status: { in: ["TODO", "IN_PROGRESS"] } },
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
            <p className="text-sm text-muted-foreground">No projects</p>
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
                      {project._count.members} members
                      {project._count.childProjects > 0 && ` · ${project._count.childProjects} sub-projects`}
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
    contracts: (
      <Card className="h-full">
        <CardHeader>
          <CardTitle>Contracts ({client.contracts.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {client.contracts.length === 0 ? (
            <p className="text-sm text-muted-foreground">No contracts</p>
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
                  <StatusBadge status={contract.status} />
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    ),
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
        <Card>
          <CardHeader>
            <CardTitle>Contacts</CardTitle>
          </CardHeader>
          <CardContent>
            <ContactSection
              contacts={client.contacts}
              clientId={client.id}
              canEdit={perms.canEdit}
            />
          </CardContent>
        </Card>
      </div>
    ),
    quotes: quotePerms.canView ? (
      <QuotesCard clientId={client.id} canCreate={quotePerms.canCreate} />
    ) : null,
    tasks: (
      <Card className="h-full">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <CheckSquare className="h-4 w-4" />
              Tasks
            </CardTitle>
            <Link href={`/tasks?clientId=${client.id}`} className="text-xs text-primary hover:underline">
              View all
            </Link>
          </div>
        </CardHeader>
        <CardContent>
          {tasks.length === 0 ? (
            <p className="text-sm text-muted-foreground">No open tasks</p>
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
