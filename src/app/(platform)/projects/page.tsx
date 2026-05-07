import { db } from "@/lib/db";
import { requireAuth, resolveModulePerms } from "@/lib/permissions";
import { getUserScope } from "@/lib/scope";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { AccessDenied } from "@/components/shared/access-denied";
import { FolderKanban } from "lucide-react";
import { ProjectCreateButton } from "./project-create-button";
import { DownloadCsvButton } from "@/components/shared/download-csv-button";
import { ProjectsPageClient, type ProjectData, type ClientGroup } from "./projects-page-client";
import type { Prisma } from "@prisma/client";

export default async function ProjectsPage({
  searchParams,
}: {
  // Honor `?clientId=...` from the "Create the first project →" link
  // on a client detail page. When present, the list filters to that
  // client and the "+ New Project" modal pre-selects them.
  searchParams: { clientId?: string };
}) {
  const user = await requireAuth();

  const perms = await resolveModulePerms(user.id, user.role, "projects");
  if (!perms.canView) return <AccessDenied module="projects" moduleLabel="Projects" moduleDescription="Project portfolio, milestones, staffing, and documents" />;

  const focusClientId = searchParams.clientId?.trim() || undefined;

  const scope = await getUserScope(user.id, user.role);
  // When the user isn't org-wide, show only projects in scope. Still include
  // parent=null filter at the top level but recursive childProjects may also
  // need filtering; we hide them via the same set below.
  const scopedProjectIds = scope.all ? null : Array.from(scope.projectIds);
  const projectWhere: Prisma.ProjectWhereInput = {
    deletedAt: null,
    parentProjectId: null,
    ...(focusClientId ? { clientId: focusClientId } : {}),
    ...(scopedProjectIds ? { id: { in: scopedProjectIds } } : {}),
  };
  // Client dropdown for "+ New Project" intentionally pulls EVERY non-
  // deleted client regardless of status — round-4 QA flagged that
  // PROSPECT clients (the natural source of new project work) were
  // hidden from the picker, blocking the most common create path.
  const clientWhere: Prisma.ClientWhereInput = {
    deletedAt: null,
    ...(scope.all ? {} : { id: { in: Array.from(scope.clientIds) } }),
  };

  const [clients, rootProjects, allProjects, serviceOfferings] = await Promise.all([
    db.client.findMany({
      where: clientWhere,
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    db.project.findMany({
      where: projectWhere,
      orderBy: { updatedAt: "desc" },
      include: {
        client: { select: { id: true, name: true } },
        _count: { select: { members: true, childProjects: { where: { deletedAt: null } }, tasks: { where: { deletedAt: null } } } },
        childProjects: {
          where: { deletedAt: null },
          include: {
            client: { select: { id: true, name: true } },
            _count: { select: { members: true, childProjects: { where: { deletedAt: null } }, tasks: { where: { deletedAt: null } } } },
            childProjects: {
              where: { deletedAt: null },
              include: {
                client: { select: { id: true, name: true } },
                _count: { select: { members: true, childProjects: { where: { deletedAt: null } }, tasks: { where: { deletedAt: null } } } },
              },
            },
          },
        },
      },
    }),
    db.project.findMany({
      where: { deletedAt: null, ...(scopedProjectIds ? { id: { in: scopedProjectIds } } : {}) },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    db.serviceOffering.findMany({
      where: { isActive: true },
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
        actions={
          <div className="flex items-center gap-2">
            {user.role === "ADMIN" && <DownloadCsvButton importerKey="projects" />}
            {perms.canCreate && (
              <ProjectCreateButton
                clients={clients}
                projects={allProjects}
                serviceOfferings={serviceOfferings}
                defaultClientId={focusClientId}
              />
            )}
          </div>
        }
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
