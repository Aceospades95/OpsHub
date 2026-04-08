import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { resolveModulePerms } from "@/lib/permissions";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { FolderKanban } from "lucide-react";
import { ProjectCreateButton } from "./project-create-button";
import { ProjectsPageClient, type ProjectData, type ClientGroup } from "./projects-page-client";

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
  const clientMap = new Map<string, ClientGroup>();
  for (const project of rootProjects) {
    const clientId = project.client.id;
    if (!clientMap.has(clientId)) {
      clientMap.set(clientId, { name: project.client.name, id: clientId, projects: [] });
    }
    clientMap.get(clientId)!.projects.push(project as unknown as ProjectData);
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
        <ProjectsPageClient
          clientGroups={clientGroups}
          clients={clients}
          allProjects={allProjects}
          canCreate={perms.canCreate}
        />
      )}
    </div>
  );
}
