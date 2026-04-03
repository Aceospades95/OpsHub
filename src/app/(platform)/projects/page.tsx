import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { resolveModulePerms } from "@/lib/permissions";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/shared/status-badge";
import { EmptyState } from "@/components/ui/empty-state";
import { TreeView, TreeNode } from "@/components/shared/tree-view";
import { FolderKanban } from "lucide-react";
import { format } from "date-fns";
import Link from "next/link";
import { ProjectCreateButton } from "./project-create-button";
import { ProjectViewToggle } from "./project-view-toggle";
import { ProjectFilters } from "./project-filters";
import { Prisma } from "@prisma/client";

interface ProjectWithRelations {
  id: string;
  name: string;
  status: string;
  startDate: Date | null;
  endDate: Date | null;
  client: { id: string; name: string };
  _count: { members: number; childProjects: number; tasks: number };
  childProjects: ProjectWithRelations[];
}

function buildTreeNodes(projects: ProjectWithRelations[]): TreeNode[] {
  return projects.map((project) => ({
    id: project.id,
    label: project.name,
    href: `/projects/${project.id}`,
    status: project.status,
    meta: project.client.name,
    children: project.childProjects.length > 0
      ? buildTreeNodes(project.childProjects)
      : undefined,
  }));
}

export default async function ProjectsPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; sort?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const perms = await resolveModulePerms(session.user.id, session.user.role, "projects");
  if (!perms.canView) redirect("/dashboard");

  const params = await searchParams;
  const view = params.view || "cards";
  const sortParam = params.sort;

  // Build orderBy for card view (all projects)
  let cardOrderBy: Prisma.ProjectOrderByWithRelationInput | Prisma.ProjectOrderByWithRelationInput[];
  switch (sortParam) {
    case "name-asc":
      cardOrderBy = { name: "asc" };
      break;
    case "name-desc":
      cardOrderBy = { name: "desc" };
      break;
    case "members":
      cardOrderBy = { members: { _count: "desc" } };
      break;
    default:
      cardOrderBy = { updatedAt: "desc" };
  }

  // For tree view, always fetch root projects with hierarchy
  const treeProjects = await db.project.findMany({
    where: { parentProjectId: null },
    orderBy: { updatedAt: "desc" },
    include: {
      client: { select: { id: true, name: true } },
      _count: { select: { members: true, childProjects: true, tasks: true } },
      childProjects: {
        include: {
          client: { select: { id: true, name: true } },
          _count: { select: { members: true, childProjects: true, tasks: true } },
          childProjects: {
            include: {
              client: { select: { id: true, name: true } },
              _count: { select: { members: true, childProjects: true, tasks: true } },
            },
          },
        },
      },
    },
  });

  // For card view, fetch ALL projects (not just roots) with parent info
  const allProjects = await db.project.findMany({
    orderBy: cardOrderBy,
    include: {
      client: { select: { id: true, name: true } },
      parentProject: { select: { id: true, name: true } },
      _count: { select: { members: true, childProjects: true, tasks: true } },
    },
  });

  const clients = await db.client.findMany({
    where: { status: "ACTIVE" },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  // Group projects by client for tree view
  type ProjectItem = ProjectWithRelations;
  const clientMap = new Map<string, { name: string; id: string; projects: ProjectItem[] }>();
  for (const project of treeProjects) {
    const clientId = project.client.id;
    if (!clientMap.has(clientId)) {
      clientMap.set(clientId, { name: project.client.name, id: clientId, projects: [] });
    }
    clientMap.get(clientId)!.projects.push(project as unknown as ProjectItem);
  }

  const clientTreeNodes: TreeNode[] = Array.from(clientMap.values()).map((client) => ({
    id: client.id,
    label: client.name,
    href: `/clients/${client.id}`,
    children: buildTreeNodes(client.projects),
  }));

  return (
    <div>
      <PageHeader
        title="Projects"
        description="Manage projects across all clients"
        actions={
          <div className="flex items-center gap-2">
            <ProjectFilters currentSort={sortParam} />
            <ProjectViewToggle currentView={view} />
            {perms.canCreate && <ProjectCreateButton clients={clients} />}
          </div>
        }
      />

      {treeProjects.length === 0 && allProjects.length === 0 ? (
        <EmptyState
          icon={FolderKanban}
          title="No projects yet"
          description="Create your first project to get started"
        />
      ) : view === "tree" ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FolderKanban className="h-5 w-5" />
              Project Hierarchy
            </CardTitle>
          </CardHeader>
          <CardContent>
            <TreeView nodes={clientTreeNodes} />
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {allProjects.map((project) => (
            <Link key={project.id} href={`/projects/${project.id}`}>
              <Card className="hover:shadow-md transition-shadow h-full">
                <CardContent className="p-5">
                  <div className="flex items-start justify-between mb-2">
                    <h3 className="font-semibold text-foreground">{project.name}</h3>
                    <StatusBadge status={project.status} />
                  </div>
                  <p className="text-sm text-muted-foreground mb-1">
                    {project.client.name}
                  </p>
                  {project.parentProject && (
                    <p className="text-xs text-muted-foreground mb-2">
                      Sub-project of: {project.parentProject.name}
                    </p>
                  )}
                  {(project.startDate || project.endDate) && (
                    <p className="text-xs text-muted-foreground mb-2">
                      {project.startDate && format(project.startDate, "MMM d, yyyy")}
                      {project.startDate && project.endDate && " — "}
                      {project.endDate && format(project.endDate, "MMM d, yyyy")}
                    </p>
                  )}
                  <div className="flex gap-4 text-xs text-muted-foreground">
                    <span>{project._count.members} members</span>
                    {project._count.childProjects > 0 && (
                      <span>{project._count.childProjects} sub-projects</span>
                    )}
                    {project._count.tasks > 0 && (
                      <span>{project._count.tasks} tasks</span>
                    )}
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
