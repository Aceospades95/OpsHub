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
import { AddTaskButton } from "@/components/shared/add-task-button";
import { QuotesCard } from "@/components/quotes/quotes-card";
import { canSeeAllQuotes } from "@/lib/quotes/access";
import { ProjectSubcontractorsCard } from "./project-subcontractors-card";
import { ProjectContractsCard } from "./project-contracts-card";
import { ProjectRelationsCard } from "./project-relations-card";
import { ProjectPartnershipsCard } from "./project-partnerships-card";
import { RecentlyViewedTracker } from "@/components/shared/recently-viewed-tracker";
import { ContactLinksCard } from "@/components/shared/contact-links-card";
import { effectiveContractStatus } from "@/lib/effective-status";

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
  // Linking an existing contract mutates the contract's projectId, so
  // the contract card's link control needs contracts-module edit rights.
  const contractPerms = await resolveModulePerms(user.id, user.role, "contracts");
  const taskPerms = await resolveModulePerms(user.id, user.role, "tasks");

  // Round-8 QA: resolve by slug-or-id (slug is the canonical href
  // for new records; cuid still works for old bookmarks).
  const project = await db.project.findFirst({
    where: {
      OR: [{ id: projectId }, { slug: projectId }],
      deletedAt: null,
    },
    include: {
      client: { select: { id: true, name: true } },
      serviceOffering: { select: { id: true, name: true } },
      parentProject: { select: { id: true, name: true } },
      childProjects: {
        where: { deletedAt: null },
        include: {
          _count: { select: { members: true, childProjects: true } },
          childProjects: {
            where: { deletedAt: null },
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
      documents: { where: { deletedAt: null }, orderBy: { updatedAt: "desc" } },
      contracts: { where: { deletedAt: null }, orderBy: { updatedAt: "desc" } },
      tools: { include: { tool: true } },
      links: true,
      embeds: true,
      // Related-project links. `relations` is the outgoing direction
      // (this project supports / references those) — the Edit dialog
      // seeds its checkbox state from relatedProjectId, and the Related
      // Projects card renders the joined project. `relatedRelations` is
      // the inverse: projects that reference THIS one ("Referenced by").
      relations: {
        select: {
          relatedProjectId: true,
          relatedProject: { select: { id: true, name: true, status: true } },
        },
      },
      relatedRelations: {
        select: {
          project: { select: { id: true, name: true, status: true } },
        },
      },
      comments: {
        include: { author: { select: { id: true, name: true } } },
        orderBy: { createdAt: "desc" },
      },
      subcontractors: {
        where: { subcontractor: { deletedAt: null } },
        include: {
          subcontractor: { select: { id: true, name: true, isPreferred: true } },
        },
        orderBy: { createdAt: "desc" },
      },
      partnerships: {
        where: { partnership: { deletedAt: null } },
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
    return <AccessDenied module="projects" moduleLabel="Projects" entityType="project" entityId={project.id} />;
  }

  // Managers can only manage staffing on projects they're assigned to.
  const canAssign = await canManageProjectAssignments(
    user.id,
    user.role,
    project.id
  );

  // Dropdown lists feed the edit/create dialogs and staffing pickers —
  // read-only viewers don't need org-wide user (incl. email), project,
  // or tool name lists, so only fetch them for users who can act on them.
  const needsPickers = perms.canEdit || perms.canCreate;

  const [
    clients,
    allUsers,
    projectTasks,
    allTools,
    allProjects,
    serviceOfferings,
    roleDefinitions,
    allSubcontractors,
    allPartnerships,
    availableContracts,
  ] = await Promise.all([
    needsPickers
      ? db.client.findMany({
          // Round-4 QA: previously filtered to status:"ACTIVE", which hid
          // PROSPECT/INACTIVE clients from the project edit picker. Any
          // non-deleted client should be assignable.
          where: { deletedAt: null },
          select: { id: true, name: true },
          orderBy: { name: "asc" },
        })
      : Promise.resolve([] as { id: string; name: string }[]),
    needsPickers || canAssign || taskPerms.canCreate
      ? db.user.findMany({
          where: { isActive: true },
          select: { id: true, name: true, email: true, jobTitle: true, location: true },
          orderBy: { name: "asc" },
        })
      : Promise.resolve([] as { id: string; name: string; email: string; jobTitle: string | null; location: string | null }[]),
    db.task.findMany({
      where: { projectId: project.id, status: { in: ["TODO", "IN_PROGRESS"] }, deletedAt: null },
      orderBy: [{ priority: "asc" }, { dueDate: "asc" }],
      include: { assignee: { select: { id: true, name: true } } },
      take: 10,
    }),
    perms.canEdit
      ? db.tool.findMany({
          where: { deletedAt: null },
          select: { id: true, name: true },
          orderBy: { name: "asc" },
        })
      : Promise.resolve([] as { id: string; name: string }[]),
    needsPickers
      ? db.project.findMany({
          where: { id: { not: project.id }, deletedAt: null },
          select: { id: true, name: true },
          orderBy: { name: "asc" },
        })
      : Promise.resolve([] as { id: string; name: string }[]),
    perms.canEdit
      ? db.serviceOffering.findMany({
          where: { isActive: true },
          select: { id: true, name: true },
          orderBy: { name: "asc" },
        })
      : Promise.resolve([] as { id: string; name: string }[]),
    canAssign
      ? db.roleDefinition.findMany({
          where: { isActive: true },
          select: { id: true, name: true },
          orderBy: { name: "asc" },
        })
      : Promise.resolve([] as { id: string; name: string }[]),
    subPerms.canEdit
      ? db.subcontractor.findMany({
          where: { status: { not: "ARCHIVED" }, deletedAt: null },
          select: { id: true, name: true },
          orderBy: { name: "asc" },
        })
      : Promise.resolve([] as { id: string; name: string }[]),
    partnerPerms.canEdit
      ? db.partnership.findMany({
          where: { status: { not: "ARCHIVED" }, deletedAt: null },
          select: { id: true, name: true },
          orderBy: { name: "asc" },
        })
      : Promise.resolve([] as { id: string; name: string }[]),
    // Contracts of THIS project's client that aren't already on this
    // project — the link picker. Same-client only (a contract is owned
    // by a client); we surface the current project so a move is explicit.
    contractPerms.canEdit
      ? db.contract.findMany({
          where: {
            clientId: project.clientId,
            deletedAt: null,
            OR: [{ projectId: null }, { projectId: { not: project.id } }],
          },
          select: {
            id: true,
            title: true,
            project: { select: { name: true } },
          },
          orderBy: { updatedAt: "desc" },
        })
      : Promise.resolve(
          [] as { id: string; title: string; project: { name: string } | null }[]
        ),
  ]);

  const treeNodes = buildTree(project.childProjects as Parameters<typeof buildTree>[0]);

  // Filter out tools already linked to this project
  const linkedToolIds = new Set(project.tools.map((pt) => pt.toolId));
  const availableTools = allTools.filter((t) => !linkedToolIds.has(t.id));

  // Related projects, both directions, for the Related Projects card.
  // relatedProject / project are required relations, so they're never
  // null; map to plain string status for the client component.
  const relatedProjects = project.relations.map((r) => ({
    id: r.relatedProject.id,
    name: r.relatedProject.name,
    status: r.relatedProject.status as string,
  }));
  const referencedByProjects = project.relatedRelations.map((r) => ({
    id: r.project.id,
    name: r.project.name,
    status: r.project.status as string,
  }));
  // Don't offer projects already linked in either direction. allProjects
  // already excludes this project itself.
  const linkedRelationIds = new Set([
    ...relatedProjects.map((p) => p.id),
    ...referencedByProjects.map((p) => p.id),
  ]);
  const availableRelationProjects = allProjects.filter(
    (p) => !linkedRelationIds.has(p.id)
  );

  const canEditLayout = user.role === "ADMIN" || user.role === "DEVELOPER";

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
    contracts: (
      <Card className="h-full">
        <CardHeader>
          <CardTitle>Contracts</CardTitle>
        </CardHeader>
        <CardContent>
          <ProjectContractsCard
            projectId={project.id}
            contracts={project.contracts.map((c) => ({
              id: c.id,
              title: c.title,
              // Date-derived — stored EXPIRING_SOON/EXPIRED lags the
              // calendar between expiry-job runs.
              status: effectiveContractStatus(c, new Date()),
            }))}
            availableContracts={availableContracts.map((c) => ({
              id: c.id,
              title: c.title,
              currentProjectName: c.project?.name ?? null,
            }))}
            canEdit={contractPerms.canEdit && perms.canEdit}
          />
        </CardContent>
      </Card>
    ),
    "related-projects": (
      <Card className="h-full">
        <CardHeader>
          <CardTitle>Related Projects</CardTitle>
        </CardHeader>
        <CardContent>
          <ProjectRelationsCard
            projectId={project.id}
            related={relatedProjects}
            referencedBy={referencedByProjects}
            availableProjects={availableRelationProjects}
            canEdit={perms.canEdit}
          />
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
          <div className="flex items-center gap-3">
            {taskPerms.canCreate && (
              <AddTaskButton
                projectId={project.id}
                users={allUsers.map((u) => ({ id: u.id, name: u.name }))}
              />
            )}
            <Link href={`/tasks?project=${project.id}`} className="text-sm text-primary hover:underline">
              View all
            </Link>
          </div>
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
                  <StatusBadge status={task.priority} className="text-xs" />
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
      <QuotesCard
        projectId={project.id}
        canCreate={quotePerms.canCreate}
        restrictToUserId={canSeeAllQuotes(user.role) ? undefined : user.id}
      />
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
    people: (
      <ContactLinksCard
        entityType="project"
        entityId={project.id}
        title="People involved"
        className="h-full"
      />
    ),
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
            isAdmin={user.role === "ADMIN"}
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
