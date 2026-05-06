import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireAuth, resolveModulePerms, canManageProjectAssignments } from "@/lib/permissions";
import { getUserScope, canViewEntity } from "@/lib/scope";
import { AccessDenied } from "@/components/shared/access-denied";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/shared/status-badge";
import { CommentSection } from "@/components/shared/comment-section";
import { TreeView, type TreeNode } from "@/components/shared/tree-view";
import { Badge } from "@/components/ui/badge";
import { formatCalendarDate } from "@/lib/dates";
import { CheckSquare, Clock } from "lucide-react";
import Link from "next/link";
import { ProjectActions } from "./project-actions";
import { MemberSection } from "./member-section";
import { ProjectStaffingSection } from "./project-staffing-section";
import { MilestoneSection } from "./milestone-section";
import { ProjectAttachments } from "./project-attachments";
import { ProjectCreateButton } from "../project-create-button";
import { AddToolButton } from "./add-tool-button";
import { TeamHierarchy } from "./team-hierarchy";
import { PageLayout } from "@/components/shared/page-layout";
import { TaskCheckbox } from "@/app/(platform)/tasks/task-checkbox";
import { QuotesCard } from "@/components/quotes/quotes-card";
import { ProjectSubcontractorsCard } from "./project-subcontractors-card";
import { ProjectPartnershipsCard } from "./project-partnerships-card";
import { RecentlyViewedTracker } from "@/components/shared/recently-viewed-tracker";

interface Props {
  params: Promise<{ projectId: string }>;
}

function buildTree(projects: { id: string; name: string; status: string; _count: { members: number; childProjects: number }; childProjects?: { id: string; name: string; status: string; _count: { members: number; childProjects: number } }[] }[]): TreeNode[] {
  return projects.map((p) => ({
    id: p.id,
    label: p.name,
    href: `/projects/${p.id}`,
    status: p.status,
    meta:
      p._count.members === 1
        ? "1 with access"
        : `${p._count.members} with access`,
    children: p.childProjects ? buildTree(p.childProjects as typeof projects) : [],
  }));
}

export default async function ProjectDetailPage({ params }: Props) {
  const { projectId } = await params;
  const user = await requireAuth();

  const perms = await resolveModulePerms(user.id, user.role, "projects");
  if (!perms.canView) return <AccessDenied module="projects" moduleLabel="Projects" moduleDescription="Project portfolio, milestones, staffing, and documents" />;

  // Quotes module visibility is independent of projects.
  const quotePerms = await resolveModulePerms(user.id, user.role, "quotes");
  // Subcontractor and Partnership modules are independent — projects show
  // their cards only when the user has at least canView on those modules.
  const subPerms = await resolveModulePerms(user.id, user.role, "subcontractors");
  const partnerPerms = await resolveModulePerms(user.id, user.role, "partnerships");

  const project = await db.project.findUnique({
    where: { id: projectId },
    include: {
      client: { select: { id: true, name: true } },
      serviceOffering: { select: { id: true, name: true } },
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
        include: { user: { select: { id: true, name: true, email: true, managerId: true, jobTitle: true, department: true, location: true } } },
      },
      assignments: {
        where: { status: { in: ["ACTIVE", "PLANNED"] } },
        include: {
          employee: { select: { id: true, name: true, jobTitle: true, location: true } },
          roleDefinition: { select: { id: true, name: true } },
          projectRole: { select: { id: true, roleDefinition: { select: { id: true, name: true } }, requiredFte: true, quantity: true } },
          serviceOffering: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: "desc" },
      },
      projectRoles: {
        include: {
          roleDefinition: { select: { id: true, name: true } },
          assignments: { select: { id: true, employeeId: true } },
        },
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
      // Existing related-project links so the Edit dialog can seed the
      // checkbox state on open. Schema name is `relations` —
      // the back-relation `relatedRelations` is the inverse direction.
      relations: {
        select: { relatedProjectId: true },
      },
      comments: {
        include: { author: { select: { id: true, name: true } } },
        orderBy: { createdAt: "desc" },
      },
      subcontractors: {
        include: {
          subcontractor: { select: { id: true, name: true, isPreferred: true } },
        },
        orderBy: { createdAt: "desc" },
      },
      partnerships: {
        include: {
          partnership: { select: { id: true, name: true, type: true, tier: true } },
        },
        orderBy: { createdAt: "desc" },
      },
    },
  });

  if (!project) notFound();

  const scope = await getUserScope(user.id, user.role);
  if (!canViewEntity(scope, "project", project.id)) {
    return <AccessDenied module="projects" moduleLabel="Projects" entityType="project" entityId={project.id} entityLabel={project.name} />;
  }

  const clients = await db.client.findMany({
    where: { status: "ACTIVE" },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  const [
    allUsers,
    projectTasks,
    allTools,
    allProjects,
    serviceOfferings,
    roleDefinitions,
    allSubcontractors,
    allPartnerships,
  ] = await Promise.all([
    db.user.findMany({
      where: { isActive: true },
      select: { id: true, name: true, email: true, jobTitle: true, location: true },
      orderBy: { name: "asc" },
    }),
    db.task.findMany({
      where: { projectId: project.id, status: { in: ["TODO", "IN_PROGRESS"] } },
      orderBy: [{ priority: "asc" }, { dueDate: "asc" }],
      include: { assignee: { select: { id: true, name: true } } },
      take: 10,
    }),
    db.tool.findMany({
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    db.project.findMany({
      where: { id: { not: project.id } },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    db.serviceOffering.findMany({
      where: { isActive: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    db.roleDefinition.findMany({
      where: { isActive: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    subPerms.canView
      ? db.subcontractor.findMany({
          where: { status: { not: "ARCHIVED" } },
          select: { id: true, name: true },
          orderBy: { name: "asc" },
        })
      : Promise.resolve([] as { id: string; name: string }[]),
    partnerPerms.canView
      ? db.partnership.findMany({
          where: { status: { not: "ARCHIVED" } },
          select: { id: true, name: true },
          orderBy: { name: "asc" },
        })
      : Promise.resolve([] as { id: string; name: string }[]),
  ]);

  const treeNodes = buildTree(project.childProjects as Parameters<typeof buildTree>[0]);

  // Filter out tools already linked to this project
  const linkedToolIds = new Set(project.tools.map((pt) => pt.toolId));
  const availableTools = allTools.filter((t) => !linkedToolIds.has(t.id));

  const canEditLayout = user.role === "ADMIN" || user.role === "DEVELOPER";
  // Managers can only manage staffing on projects they're assigned to.
  const canAssign = await canManageProjectAssignments(
    user.id,
    user.role,
    project.id
  );

  const cardMap: Record<string, React.ReactNode> = {
    "sub-projects": (
      <Card className="h-full">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Sub-Projects ({project.childProjects.length})</CardTitle>
          {perms.canCreate && (
            <ProjectCreateButton
              clients={clients}
              projects={allProjects}
              defaultClientId={project.client.id}
              defaultParentId={project.id}
            />
          )}
        </CardHeader>
        <CardContent>
          <TreeView nodes={treeNodes} />
        </CardContent>
      </Card>
    ),
    milestones: (
      <Card className="h-full">
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
    ),
    documents: (
      <Card className="h-full">
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
                  className="flex items-center justify-between rounded border border-border bg-muted p-3 hover:border-primary transition-colors"
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
    ),
    contracts: project.contracts.length > 0 ? (
      <Card className="h-full">
        <CardHeader>
          <CardTitle>Contracts</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {project.contracts.map((contract) => (
              <Link
                key={contract.id}
                href={`/contracts/${contract.id}`}
                className="flex items-center justify-between rounded border border-border bg-muted p-3 hover:border-primary transition-colors"
              >
                <p className="text-sm font-medium">{contract.title}</p>
                <StatusBadge status={contract.status} />
              </Link>
            ))}
          </div>
        </CardContent>
      </Card>
    ) : (
      <Card className="h-full">
        <CardHeader><CardTitle>Contracts</CardTitle></CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">No contracts linked to this project</p>
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
            comments={project.comments}
            entityType="project"
            entityId={project.id}
            canComment={perms.canComment}
            canDelete={perms.canDelete}
            currentUserId={user.id}
          />
        </CardContent>
      </Card>
    ),
    team: (
      <Card className="h-full">
        <CardHeader>
          <CardTitle>Staffing ({project.assignments.length})</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <ProjectStaffingSection
            projectId={project.id}
            projectName={project.name}
            clientId={project.client.id}
            serviceOfferingId={project.serviceOfferingId}
            assignments={project.assignments as Parameters<typeof ProjectStaffingSection>[0]["assignments"]}
            projectRoles={project.projectRoles as Parameters<typeof ProjectStaffingSection>[0]["projectRoles"]}
            roleDefinitions={roleDefinitions}
            allUsers={allUsers}
            canEdit={canAssign}
          />
          <div className="pt-4 border-t border-border space-y-2">
            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Project Access ({project.members.length})</h4>
            <TeamHierarchy members={project.members as Parameters<typeof TeamHierarchy>[0]["members"]} />
            <MemberSection
              members={project.members}
              projectId={project.id}
              allUsers={allUsers}
              canEdit={canAssign}
            />
          </div>
        </CardContent>
      </Card>
    ),
    tasks: (
      <Card className="h-full">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <CheckSquare className="h-5 w-5" />
            Tasks ({projectTasks.length})
          </CardTitle>
          <Link href={`/tasks?projectId=${project.id}`} className="text-sm text-primary hover:underline">
            View all
          </Link>
        </CardHeader>
        <CardContent>
          {projectTasks.length === 0 ? (
            <p className="text-sm text-muted-foreground">No open tasks</p>
          ) : (
            <div className="space-y-2">
              {projectTasks.map((task) => (
                <div key={task.id} className="flex items-center justify-between rounded border border-border bg-muted p-3 hover:border-primary transition-colors">
                  <div className="flex items-center gap-3 min-w-0">
                    <TaskCheckbox taskId={task.id} status={task.status} />
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{task.title}</p>
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
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                    task.priority === "HIGH" ? "bg-red-100 text-red-800" :
                    task.priority === "MEDIUM" ? "bg-yellow-100 text-yellow-800" :
                    "bg-green-100 text-green-800"
                  }`}>
                    {task.priority}
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    ),
    tools: (
      <Card className="h-full">
        <CardHeader>
          <CardTitle>Tools ({project.tools.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {project.tools.length > 0 && (
            <div className="space-y-2 mb-3">
              {project.tools.map((pt) => (
                <Link
                  key={pt.id}
                  href={`/tools/${pt.tool.id}`}
                  className="block rounded border border-border bg-muted p-2 hover:border-primary text-sm transition-colors"
                >
                  {pt.tool.name}
                </Link>
              ))}
            </div>
          )}
          {project.tools.length === 0 && (
            <p className="text-sm text-muted-foreground mb-3">No tools linked</p>
          )}
          {perms.canEdit && availableTools.length > 0 && (
            <AddToolButton
              projectId={project.id}
              availableTools={availableTools}
            />
          )}
        </CardContent>
      </Card>
    ),
    attachments: (
      <Card className="h-full">
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
    ),
    quotes: quotePerms.canView ? (
      <QuotesCard projectId={project.id} canCreate={quotePerms.canCreate} />
    ) : null,
    subcontractors: subPerms.canView ? (
      <Card className="h-full">
        <CardHeader>
          <CardTitle>Subcontractors ({project.subcontractors.length})</CardTitle>
        </CardHeader>
        <CardContent>
          <ProjectSubcontractorsCard
            projectId={project.id}
            links={project.subcontractors.map((sp) => ({
              id: sp.id,
              subcontractorId: sp.subcontractorId,
              subcontractorName: sp.subcontractor?.name || "",
              subcontractorPreferred: sp.subcontractor?.isPreferred ?? false,
              scope: sp.scope,
              role: sp.role,
              status: sp.status,
              startDate: sp.startDate,
              endDate: sp.endDate,
              contractValue: sp.contractValue,
              currency: sp.currency,
              rate: sp.rate,
              rateUnit: sp.rateUnit,
              notes: sp.notes,
            }))}
            allSubcontractors={allSubcontractors}
            canEdit={subPerms.canEdit}
          />
        </CardContent>
      </Card>
    ) : null,
    partnerships: partnerPerms.canView ? (
      <Card className="h-full">
        <CardHeader>
          <CardTitle>Partners ({project.partnerships.length})</CardTitle>
        </CardHeader>
        <CardContent>
          <ProjectPartnershipsCard
            projectId={project.id}
            links={project.partnerships.map((pp) => ({
              id: pp.id,
              partnershipId: pp.partnershipId,
              partnershipName: pp.partnership?.name || "",
              partnershipType: pp.partnership?.type || "OTHER",
              partnershipTier: pp.partnership?.tier || null,
              role: pp.role,
              notes: pp.notes,
              referralValue: pp.referralValue,
              currency: pp.currency,
            }))}
            allPartnerships={allPartnerships}
            canEdit={partnerPerms.canEdit}
          />
        </CardContent>
      </Card>
    ) : null,
  };

  return (
    <div>
      <RecentlyViewedTracker
        type="project"
        id={project.id}
        label={project.name}
        sublabel={project.client.name}
        href={`/projects/${project.id}`}
      />
      <PageHeader
        title={project.name}
        description={project.description || undefined}
        actions={
          <ProjectActions
            project={{
              ...project,
              clientId: project.client.id,
              relatedProjectIds: project.relations.map((r) => r.relatedProjectId),
            }}
            clients={clients}
            serviceOfferings={serviceOfferings}
            allProjects={allProjects}
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

      <div className="flex items-center gap-3 mb-6 flex-wrap">
        <StatusBadge status={project.status} />
        <Link href={`/clients/${project.client.id}`} className="text-sm text-primary hover:underline">
          {project.client.name}
        </Link>
        {project.serviceOffering && (
          <Badge variant="outline">{project.serviceOffering.name}</Badge>
        )}
        {project.startDate && (
          <span className="text-sm text-muted-foreground">
            {formatCalendarDate(project.startDate, "MMM d, yyyy")}
            {project.endDate && ` — ${formatCalendarDate(project.endDate, "MMM d, yyyy")}`}
          </span>
        )}
      </div>

      <PageLayout pageType="project-detail" cards={cardMap} canEdit={canEditLayout} mode="flow" />
    </div>
  );
}
