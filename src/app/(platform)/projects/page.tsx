import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { resolveModulePerms } from "@/lib/permissions";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { TreeView, TreeNode } from "@/components/shared/tree-view";
import { FolderKanban } from "lucide-react";
import { ProjectCreateButton } from "./project-create-button";

interface ProjectWithRelations {
  id: string;
  name: string;
  status: string;
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
    meta: `${project._count.members} members`,
    children: project.childProjects.length > 0
      ? buildTreeNodes(project.childProjects)
      : undefined,
  }));
}

export default async function ProjectsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const perms = await resolveModulePerms(session.user.id, session.user.role, "projects");
  if (!perms.canView) redirect("/dashboard");

  const clients = await db.client.findMany({
    where: { status: "ACTIVE" },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  // Fetch root projects with hierarchy, grouped by client
  const rootProjects = await db.project.findMany({
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

  // Group by client
  const clientMap = new Map<string, { name: string; id: string; projects: ProjectWithRelations[] }>();
  for (const project of rootProjects) {
    const clientId = project.client.id;
    if (!clientMap.has(clientId)) {
      clientMap.set(clientId, { name: project.client.name, id: clientId, projects: [] });
    }
    clientMap.get(clientId)!.projects.push(project as unknown as ProjectWithRelations);
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
        actions={perms.canCreate ? <ProjectCreateButton clients={clients} /> : undefined}
      />

      {rootProjects.length === 0 ? (
        <EmptyState
          icon={FolderKanban}
          title="No projects yet"
          description="Create your first project to get started"
        />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FolderKanban className="h-5 w-5" />
              Project Hierarchy
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2 px-2 py-2 mb-2 border-b text-xs font-semibold uppercase tracking-wider text-muted-foreground" style={{ borderColor: "color-mix(in srgb, var(--foreground) 10%, transparent)" }}>
              <span className="w-6" />
              <span className="flex-1">Project</span>
              <span className="w-24 text-center">Status</span>
              <span className="w-32 text-right">Members</span>
            </div>
            <TreeView nodes={clientTreeNodes} />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
