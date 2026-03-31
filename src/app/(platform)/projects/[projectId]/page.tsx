import { auth } from "@/lib/auth";
import { redirect, notFound } from "next/navigation";
import { db } from "@/lib/db";
import { resolveModulePerms } from "@/lib/permissions";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/shared/status-badge";
import { CommentSection } from "@/components/shared/comment-section";
import { FileList } from "@/components/shared/file-list";
import { TreeView, type TreeNode } from "@/components/shared/tree-view";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";
import Link from "next/link";
import { ProjectActions } from "./project-actions";
import { MemberSection } from "./member-section";
import { MilestoneSection } from "./milestone-section";
import { ProjectAttachments } from "./project-attachments";
import { ProjectCreateButton } from "../project-create-button";

interface Props {
  params: Promise<{ projectId: string }>;
}

function buildTree(projects: { id: string; name: string; status: string; _count: { members: number; childProjects: number }; childProjects?: { id: string; name: string; status: string; _count: { members: number; childProjects: number } }[] }[]): TreeNode[] {
  return projects.map((p) => ({
    id: p.id,
    label: p.name,
    href: `/projects/${p.id}`,
    status: p.status,
    meta: `${p._count.members} members`,
    children: p.childProjects ? buildTree(p.childProjects as typeof projects) : [],
  }));
}

export default async function ProjectDetailPage({ params }: Props) {
  const { projectId } = await params;
  const session = await auth();
  if (!session?.user) redirect("/login");

  const perms = await resolveModulePerms(session.user.id, session.user.role, "projects");
  if (!perms.canView) redirect("/dashboard");

  const project = await db.project.findUnique({
    where: { id: projectId },
    include: {
      client: { select: { id: true, name: true } },
      parentProject: { select: { id: true, name: true } },
      childProjects: {
        include: {
          _count: { select: { members: true, childProjects: true } },
          childProjects: {
            include: { _count: { select: { members: true, childProjects: true } } },
          },
        },
      },
      members: {
        include: { user: { select: { id: true, name: true, email: true } } },
      },
      milestones: {
        include: {
          assignees: {
            include: { user: { select: { id: true, name: true } } },
          },
        },
        orderBy: [{ completed: "asc" }, { dueDate: "asc" }],
      },
      documents: { orderBy: { updatedAt: "desc" } },
      contracts: { orderBy: { updatedAt: "desc" } },
      tools: { include: { tool: true } },
      links: true,
      embeds: true,
      comments: {
        include: { author: { select: { id: true, name: true } } },
        orderBy: { createdAt: "desc" },
      },
    },
  });

  if (!project) notFound();

  const clients = await db.client.findMany({
    where: { status: "ACTIVE" },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  const allUsers = await db.user.findMany({
    where: { isActive: true },
    select: { id: true, name: true, email: true },
    orderBy: { name: "asc" },
  });

  const treeNodes = buildTree(project.childProjects as Parameters<typeof buildTree>[0]);

  return (
    <div>
      <PageHeader
        title={project.name}
        description={project.description || undefined}
        actions={
          <ProjectActions
            project={{ ...project, clientId: project.client.id }}
            clients={clients}
            canEdit={perms.canEdit}
            canDelete={perms.canDelete}
          />
        }
      />

      {/* Breadcrumb for sub-projects */}
      {project.parentProject && (
        <div className="mb-4 text-sm text-muted-foreground">
          <Link href={`/projects/${project.parentProject.id}`} className="hover:text-primary">
            {project.parentProject.name}
          </Link>
          <span className="mx-2">→</span>
          <span className="text-foreground">{project.name}</span>
        </div>
      )}

      <div className="flex items-center gap-3 mb-6">
        <StatusBadge status={project.status} />
        <Link href={`/clients/${project.client.id}`} className="text-sm text-primary hover:underline">
          {project.client.name}
        </Link>
        {project.startDate && (
          <span className="text-sm text-muted-foreground">
            {format(project.startDate, "MMM d, yyyy")}
            {project.endDate && ` — ${format(project.endDate, "MMM d, yyyy")}`}
          </span>
        )}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-6">
          {/* Sub-projects */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>Sub-Projects ({project.childProjects.length})</CardTitle>
              {perms.canCreate && (
                <ProjectCreateButton
                  clients={clients}
                  defaultClientId={project.client.id}
                  defaultParentId={project.id}
                />
              )}
            </CardHeader>
            <CardContent>
              <TreeView nodes={treeNodes} />
            </CardContent>
          </Card>

          {/* Milestones */}
          <Card>
            <CardHeader>
              <CardTitle>Milestones ({project.milestones.length})</CardTitle>
            </CardHeader>
            <CardContent>
              <MilestoneSection
                milestones={project.milestones}
                projectId={project.id}
                allUsers={allUsers}
                canEdit={perms.canEdit}
                canCreate={perms.canCreate}
                canDelete={perms.canDelete}
              />
            </CardContent>
          </Card>

          {/* Documents */}
          <Card>
            <CardHeader>
              <CardTitle>Documents ({project.documents.length})</CardTitle>
            </CardHeader>
            <CardContent>
              {project.documents.length === 0 ? (
                <p className="text-sm text-muted-foreground">No documents</p>
              ) : (
                <div className="space-y-2">
                  {project.documents.map((doc) => (
                    <Link
                      key={doc.id}
                      href={`/projects/${project.id}/documents/${doc.id}`}
                      className="flex items-center justify-between rounded border border-border p-3 hover:bg-muted transition-colors"
                    >
                      <div>
                        <p className="text-sm font-medium">{doc.title}</p>
                        <p className="text-xs text-muted-foreground">
                          {doc.type} · v{doc.version}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        {doc.published && <Badge variant="success">Published</Badge>}
                      </div>
                    </Link>
                  ))}
                </div>
              )}
              {perms.canCreate && (
                <Link
                  href={`/projects/${project.id}/documents/new`}
                  className="mt-3 inline-flex items-center text-sm text-primary hover:underline"
                >
                  + Create Document
                </Link>
              )}
            </CardContent>
          </Card>

          {/* Contracts */}
          {project.contracts.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Contracts</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {project.contracts.map((contract) => (
                    <Link
                      key={contract.id}
                      href={`/contracts/${contract.id}`}
                      className="flex items-center justify-between rounded border border-border p-3 hover:bg-muted transition-colors"
                    >
                      <p className="text-sm font-medium">{contract.title}</p>
                      <StatusBadge status={contract.status} />
                    </Link>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Comments */}
          <Card>
            <CardHeader>
              <CardTitle>Comments</CardTitle>
            </CardHeader>
            <CardContent>
              <CommentSection
                comments={project.comments}
                entityType="project"
                entityId={project.id}
                canComment={perms.canComment}
                canDelete={perms.canDelete}
                currentUserId={session.user.id}
              />
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          {/* Team Members */}
          <Card>
            <CardHeader>
              <CardTitle>Team ({project.members.length})</CardTitle>
            </CardHeader>
            <CardContent>
              <MemberSection
                members={project.members}
                projectId={project.id}
                allUsers={allUsers}
                canEdit={perms.canEdit}
              />
            </CardContent>
          </Card>

          {/* Tools */}
          {project.tools.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Tools</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {project.tools.map((pt) => (
                    <Link
                      key={pt.id}
                      href={`/tools/${pt.tool.id}`}
                      className="block rounded border border-border p-2 hover:bg-muted text-sm"
                    >
                      {pt.tool.name}
                    </Link>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Attachments */}
          <Card>
            <CardHeader>
              <CardTitle>Attachments</CardTitle>
            </CardHeader>
            <CardContent>
              <ProjectAttachments
                projectId={project.id}
                links={project.links}
                embeds={project.embeds}
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
