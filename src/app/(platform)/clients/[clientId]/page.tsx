import { auth } from "@/lib/auth";
import { redirect, notFound } from "next/navigation";
import { db } from "@/lib/db";
import { resolveModulePerms } from "@/lib/permissions";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/shared/status-badge";
import { CommentSection } from "@/components/shared/comment-section";
import { FileList } from "@/components/shared/file-list";
import { Badge } from "@/components/ui/badge";
import { Globe, Mail, Phone, Star } from "lucide-react";
import Link from "next/link";
import { ClientActions } from "./client-actions";
import { ContactSection } from "./contact-section";
import { ClientAttachments } from "./client-attachments";

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

  // Get links and embeds separately since they're not directly on client
  const links = await db.externalLink.findMany({ where: { projectId: undefined, contractId: undefined, supplierId: undefined } });
  const embeds = await db.embed.findMany({ where: { projectId: undefined, contractId: undefined, toolId: undefined } });

  return (
    <div>
      <PageHeader
        title={client.name}
        description={client.description || undefined}
        actions={
          <ClientActions
            client={client}
            canEdit={perms.canEdit}
            canDelete={perms.canDelete}
          />
        }
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-6">
          {/* Client Info */}
          <Card>
            <CardContent className="p-6">
              <div className="flex items-center gap-3 mb-4">
                <StatusBadge status={client.status} />
                {client.industry && <Badge variant="outline">{client.industry}</Badge>}
              </div>
              {client.summary && (
                <div className="mb-4">
                  <h4 className="text-sm font-medium mb-1">Summary</h4>
                  <p className="text-sm text-muted-foreground whitespace-pre-wrap">{client.summary}</p>
                </div>
              )}
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

          {/* Projects */}
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

          {/* Contracts */}
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

          {/* Comments */}
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
        </div>

        {/* Right sidebar */}
        <div className="space-y-6">
          {/* Contacts */}
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

          {/* Attachments */}
          <Card>
            <CardHeader>
              <CardTitle>Attachments</CardTitle>
            </CardHeader>
            <CardContent>
              <ClientAttachments
                clientId={client.id}
                links={links}
                embeds={embeds}
                canEdit={perms.canEdit}
                canDelete={perms.canDelete}
              />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
