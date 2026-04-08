import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { resolveModulePerms } from "@/lib/permissions";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { TreeView, TreeNode } from "@/components/shared/tree-view";
import { FolderKanban, Building2 } from "lucide-react";
import Link from "next/link";
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

  const [clients, rootProjects, allProjects] = await Promise.all([
    db.client.findMany({
      where: { status: "ACTIVE" },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    db.project.findMany({
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
    }),
    db.project.findMany({
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);

  // Group by client
  const clientMap = new Map<string, { name: string; id: string; projects: ProjectWithRelations[] }>();
  for (const project of rootProjects) {
    const clientId = project.client.id;
    if (!clientMap.has(clientId)) {
      clientMap.set(clientId, { name: project.client.name, id: clientId, projects: [] });
    }
    clientMap.get(clientId)!.projects.push(project as unknown as ProjectWithRelations);
  }

  const clientGroups = Array.from(clientMap.values()).sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div>
      <PageHeader
        title="Projects"
        description="Manage projects across all clients"
        actions={perms.canCreate ? <ProjectCreateButton clients={clients} projects={allProjects} /> : undefined}
      />

      {rootProjects.length === 0 ? (
        <EmptyState
          icon={FolderKanban}
          title="No projects yet"
          description="Create your first project to get started"
        />
      ) : (
        <div className="space-y-6">
          {clientGroups.map((client) => (
            <Card key={client.id}>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="flex items-center gap-2">
                    <Building2 className="h-5 w-5 text-primary" />
                    <Link href={`/clients/${client.id}`} className="hover:underline hover:text-primary">
                      {client.name}
                    </Link>
                    <span className="text-sm font-normal text-muted-foreground ml-1">
                      {client.projects.length} {client.projects.length === 1 ? "project" : "projects"}
                    </span>
                  </CardTitle>
                  {perms.canCreate && (
                    <ProjectCreateButton
                      clients={clients}
                      projects={allProjects}
                      defaultClientId={client.id}
                    />
                  )}
                </div>
              </CardHeader>
              <CardContent>
                <div
                  className="flex items-center gap-2 px-2 py-2 mb-2 border-b text-xs font-semibold uppercase tracking-wider text-muted-foreground"
                  style={{ borderColor: "color-mix(in srgb, var(--foreground) 10%, transparent)" }}
                >
                  <span className="w-6" />
                  <span className="flex-1">Project</span>
                  <span className="w-24 text-center">Status</span>
                  <span className="w-32 text-right">Members</span>
                </div>
                <TreeView nodes={buildTreeNodes(client.projects)} />
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
