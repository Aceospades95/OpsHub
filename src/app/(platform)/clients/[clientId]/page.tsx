import { auth } from "@/lib/auth";
import { redirect, notFound } from "next/navigation";
import { db } from "@/lib/db";
import { resolveModulePerms } from "@/lib/permissions";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/shared/status-badge";
import { CommentSection } from "@/components/shared/comment-section";
import { Badge } from "@/components/ui/badge";
import { Avatar } from "@/components/ui/avatar";
import { Globe, Mail, Phone, Star, CheckSquare, Clock, UserCircle } from "lucide-react";
import { format } from "date-fns";
import Link from "next/link";
import { PageLayout } from "@/components/shared/page-layout";
import { ClientActions } from "./client-actions";
import { ContactSection } from "./contact-section";

interface Props {
  params: Promise<{ clientId: string }>;
}

export default async function ClientDetailPage({ params }: Props) {
  const { clientId } = await params;
  const session = await auth();
  if (!session?.user) redirect("/login");

  const perms = await resolveModulePerms(session.user.id, session.user.role, "clients");
  if (!perms.canView) redirect("/dashboard");

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

  // Get tasks associated with this client
  const tasks = await db.task.findMany({
    where: { clientId: client.id, status: { in: ["TODO", "IN_PROGRESS"] } },
    orderBy: [{ priority: "asc" }, { dueDate: "asc" }],
    include: { assignee: { select: { name: true } } },
    take: 10,
  });

  const users = await db.user.findMany({
    where: { isActive: true },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  const isAdmin = session.user.role === "ADMIN";

  // Define all card sections by ID
  const cardMap: Record<string, React.ReactNode> = {
    "client-info": (
      <>
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
      </>
    ),
    projects: (
      <Card>
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
                  className="flex items-center justify-between rounded border border-border p-3 hover:bg-muted transition-colors"
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
      <Card>
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
                  className="flex items-center justify-between rounded border border-border p-3 hover:bg-muted transition-colors"
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
      <Card>
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
            currentUserId={session.user.id}
          />
        </CardContent>
      </Card>
    ),
    contacts: (
      <>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <UserCircle className="h-4 w-4" />
              Account Manager
            </CardTitle>
          </CardHeader>
          <CardContent>
            {client.accountManager ? (
              <div className="flex items-center gap-3">
                <Avatar name={client.accountManager.name || "?"} size="sm" />
                <span className="text-sm font-medium">{client.accountManager.name}</span>
              </div>
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
      </>
    ),
    tasks: (
      <Card>
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
                <div key={task.id} className="flex items-start gap-2 text-sm">
                  <CheckSquare className={`h-4 w-4 mt-0.5 shrink-0 ${task.status === "IN_PROGRESS" ? "text-primary" : "text-muted-foreground"}`} />
                  <div className="min-w-0">
                    <p className="font-medium truncate">{task.title}</p>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      {task.assignee && <span>{task.assignee.name}</span>}
                      {task.dueDate && (
                        <span className={`flex items-center gap-1 ${new Date(task.dueDate) < new Date() ? "text-destructive" : ""}`}>
                          <Clock className="h-3 w-3" />
                          {format(new Date(task.dueDate), "MMM d")}
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

      <PageLayout pageType="client-detail" cards={cardMap} isAdmin={isAdmin} />
    </div>
  );
}
