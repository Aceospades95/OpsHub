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
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { StatusBadge } from "@/components/shared/status-badge";
import { formatCalendarDate } from "@/lib/dates";
import { resolveViewPreference } from "@/lib/view-preference";
import { ViewOptionsBar } from "@/components/shared/view-options-bar";
import { GroupSection } from "@/components/shared/group-section";
import { groupRows } from "@/lib/group-rows";

const GROUP_OPTIONS = [
  { value: "client", label: "Client" },
  { value: "status", label: "Status" },
  { value: "owner", label: "Owner" },
  { value: "offering", label: "Service offering" },
] as const;
type GroupKey = (typeof GROUP_OPTIONS)[number]["value"];

export const metadata = { title: "Projects · OpsHub" };

export default async function ProjectsPage({
  searchParams,
}: {
  // Honor `?clientId=...` from the "Create the first project →" link
  // on a client detail page. When present, the list filters to that
  // client and the "+ New Project" modal pre-selects them.
  searchParams: { clientId?: string; view?: string; groupBy?: string };
}) {
  const user = await requireAuth();

  const perms = await resolveModulePerms(user.id, user.role, "projects");
  if (!perms.canView) return <AccessDenied module="projects" moduleLabel="Projects" moduleDescription="Project portfolio, milestones, staffing, and documents" />;

  const focusClientId = searchParams.clientId?.trim() || undefined;
  const view = resolveViewPreference(searchParams.view, "projects", ["table", "tree"], "table");
  const groupBy = GROUP_OPTIONS.some((o) => o.value === searchParams.groupBy)
    ? (searchParams.groupBy as GroupKey)
    : null;

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

  // Flat list for the table view — includes sub-projects (the tree view
  // nests them instead). Only fetched when the table is showing.
  const flatProjects =
    view === "table"
      ? await db.project.findMany({
          where: {
            deletedAt: null,
            ...(focusClientId ? { clientId: focusClientId } : {}),
            ...(scopedProjectIds ? { id: { in: scopedProjectIds } } : {}),
          },
          orderBy: [{ client: { name: "asc" } }, { name: "asc" }],
          include: {
            client: { select: { id: true, name: true } },
            owner: { select: { id: true, name: true } },
            serviceOffering: { select: { id: true, name: true } },
            _count: {
              select: {
                tasks: { where: { status: { in: ["TODO", "IN_PROGRESS"] }, deletedAt: null } },
              },
            },
          },
        })
      : [];

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

      <ViewOptionsBar
        view={view}
        viewOptions={[
          { value: "table", label: "Table" },
          { value: "tree", label: "Tree" },
        ]}
        storageKey="projects"
        groupBy={view === "table" ? groupBy : undefined}
        groupByOptions={view === "table" ? [...GROUP_OPTIONS] : undefined}
      />

      {view === "table" ? (
        flatProjects.length === 0 ? (
          <EmptyState
            icon={FolderKanban}
            title="No projects yet"
            description="Create your first project to get started"
          />
        ) : (
          (() => {
            type FlatProject = (typeof flatProjects)[number];
            const groupKeyOf = (project: FlatProject, key: GroupKey): string | null => {
              switch (key) {
                case "client":
                  return project.client.name;
                case "status":
                  return project.status.replace("_", " ").charAt(0) + project.status.replace("_", " ").slice(1).toLowerCase();
                case "owner":
                  return project.owner?.name ?? null;
                case "offering":
                  return project.serviceOffering?.name ?? null;
              }
            };
            const renderTable = (rows: FlatProject[]) => (
              <Card>
                <CardContent className="p-0 overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border text-left text-xs text-muted-foreground">
                        <th className="p-3 font-medium">Project</th>
                        <th className="p-3 font-medium">Client</th>
                        <th className="p-3 font-medium">Status</th>
                        <th className="p-3 font-medium">Owner</th>
                        <th className="p-3 font-medium">Timeline</th>
                        <th className="p-3 font-medium text-right">Open tasks</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((project) => (
                        <tr key={project.id} className="border-b border-border last:border-0 hover:bg-muted/50">
                          <td className="p-3">
                            <Link
                              href={`/projects/${project.slug ?? project.id}`}
                              className="font-medium hover:text-primary hover:underline"
                            >
                              {project.name}
                            </Link>
                            {project.parentProjectId && (
                              <span className="ml-2 text-xs text-muted-foreground">(sub-project)</span>
                            )}
                          </td>
                          <td className="p-3 text-muted-foreground">
                            <Link href={`/clients/${project.client.id}`} className="hover:text-primary hover:underline">
                              {project.client.name}
                            </Link>
                          </td>
                          <td className="p-3"><StatusBadge status={project.status} /></td>
                          <td className="p-3 text-muted-foreground">{project.owner?.name ?? "—"}</td>
                          <td className="p-3 text-muted-foreground text-xs">
                            {project.startDate || project.endDate
                              ? `${project.startDate ? formatCalendarDate(project.startDate, "MMM d, yyyy") : "…"} – ${
                                  project.endDate ? formatCalendarDate(project.endDate, "MMM d, yyyy") : "…"
                                }`
                              : "—"}
                          </td>
                          <td className="p-3 text-right tabular-nums">
                            {project._count.tasks > 0 ? (
                              <Link href={`/tasks?project=${project.id}`} className="hover:text-primary hover:underline">
                                {project._count.tasks}
                              </Link>
                            ) : (
                              <span className="text-muted-foreground">0</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </CardContent>
              </Card>
            );
            const groups = groupBy ? groupRows(flatProjects, (row) => groupKeyOf(row, groupBy)) : null;
            return groups ? (
              groups.map((group) => (
                <GroupSection key={group.label} label={group.label} count={group.rows.length}>
                  {renderTable(group.rows)}
                </GroupSection>
              ))
            ) : (
              renderTable(flatProjects)
            );
          })()
        )
      ) : rootProjects.length === 0 ? (
        <EmptyState
          icon={FolderKanban}
          title="No projects yet"
          description="Create your first project to get started"
        />
      ) : (
        // Per-group "New Project" buttons were removed — the page-header
        // button is the single create entry point.
        <ProjectsPageClient clientGroups={clientGroups} />
      )}
    </div>
  );
}
