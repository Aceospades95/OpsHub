import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { resolveModulePerms } from "@/lib/permissions";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/shared/status-badge";
import { EmptyState } from "@/components/ui/empty-state";
import { TreeView, TreeNode } from "@/components/shared/tree-view";
import { FolderKanban, CornerDownRight } from "lucide-react";
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
  searchParams: { view?: string; sort?: string };
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const perms = await resolveModulePerms(session.user.id, session.user.role, "projects");
  if (!perms.canView) redirect("/dashboard");

  const view = searchParams.view || "cards";
  const sortParam = searchParams.sort;

  // Build orderBy for card view
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

  // For tree view: fetch root projects with hierarchy
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

  // For card view: fetch root projects with children inline
  const rootProjects = await db.project.findMany({
    where: { parentProjectId: null },
    orderBy: cardOrderBy,
    include: {
      client: { select: { id: true, name: true } },
      _count: { select: { members: true, childProjects: true, tasks: true } },
      childProjects: {
        orderBy: cardOrderBy,
        include: {
          client: { select: { id: true, name: true } },
          _count: { select: { members: true, childProjects: true, tasks: true } },
        },
      },
    },
  });

  const clients = await db.client.findMany({
    where: { status: "ACTIVE" },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  // Group for tree view
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

      {rootProjects.length === 0 ? (
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
            {/* Tree view header */}
            <div className="flex items-center gap-2 px-2 py-2 mb-2 border-b border-border text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              <span className="w-5" />
              <span className="flex-1">Name</span>
              <span className="w-24 text-center">Status</span>
              <span className="w-32 text-right">Client</span>
            </div>
            <TreeView nodes={clientTreeNodes} />
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {rootProjects.map((project) => (
            <div key={project.id}>
              {/* Parent project card */}
              <Link href={`/projects/${project.id}`}>
                <Card className="hover:shadow-md transition-shadow">
                  <CardContent className="p-5">
                    <div className="flex items-start justify-between mb-2">
                      <div>
                        <h3 className="font-semibold text-foreground">{project.name}</h3>
                        <p className="text-sm text-muted-foreground">{project.client.name}</p>
                      </div>
                      <StatusBadge status={project.status} />
                    </div>
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

              {/* Sub-project cards — indented and connected */}
              {project.childProjects.length > 0 && (
                <div className="ml-6 mt-2 space-y-2 border-l-2 border-primary/20 pl-4">
                  {project.childProjects.map((child) => (
                    <Link key={child.id} href={`/projects/${child.id}`}>
                      <Card className="hover:shadow-sm transition-shadow border-l-2 border-primary/40">
                        <CardContent className="p-4">
                          <div className="flex items-start justify-between mb-1">
                            <div className="flex items-center gap-2">
                              <CornerDownRight className="h-3.5 w-3.5 text-primary/50 shrink-0" />
                              <h4 className="font-medium text-sm text-foreground">{child.name}</h4>
                            </div>
                            <StatusBadge status={child.status} />
                          </div>
                          <div className="flex gap-4 text-xs text-muted-foreground ml-5.5">
                            <span>{child._count.members} members</span>
                            {child._count.tasks > 0 && (
                              <span>{child._count.tasks} tasks</span>
                            )}
                          </div>
                        </CardContent>
                      </Card>
                    </Link>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
