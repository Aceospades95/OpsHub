import { db } from "@/lib/db";
import { requireAuth, resolveModulePerms } from "@/lib/permissions";
import { getUserScope, hasOrgWideManage } from "@/lib/scope";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { StatusBadge } from "@/components/shared/status-badge";
import { Badge } from "@/components/ui/badge";
import { Search, BookOpen, Users, HardHat, Handshake } from "lucide-react";
import Link from "next/link";

interface Props {
  searchParams: { q?: string };
}

export default async function SearchPage({ searchParams }: Props) {
  const q = searchParams.q;
  const user = await requireAuth();

  const { id: userId, role } = user;
  const query = q?.trim() || "";

  if (!query) {
    return (
      <div>
        <PageHeader title="Search" description="Search across all modules" />
        <div className="flex flex-col items-center py-12 text-muted-foreground">
          <Search className="h-12 w-12 mb-4" />
          <p>Search clients, projects, contracts, suppliers, subcontractors, partnerships, tasks, team members, and intranet resources</p>
        </div>
      </div>
    );
  }

  // Module-level canView for each section. Entity-scoped modules
  // (projects, clients, contracts) get an additional ID-set filter
  // applied to the SQL where-clause so a user with module canView
  // but no entity scope only sees the entities they're assigned to.
  const [
    scope,
    clientPerms,
    projectPerms,
    contractPerms,
    supplierPerms,
    subcontractorPerms,
    partnershipPerms,
    intranetPerms,
    tasksPerms,
    teamPerms,
  ] = await Promise.all([
    getUserScope(userId, role),
    resolveModulePerms(userId, role, "clients"),
    resolveModulePerms(userId, role, "projects"),
    resolveModulePerms(userId, role, "contracts"),
    resolveModulePerms(userId, role, "suppliers"),
    resolveModulePerms(userId, role, "subcontractors"),
    resolveModulePerms(userId, role, "partnerships"),
    resolveModulePerms(userId, role, "intranet"),
    resolveModulePerms(userId, role, "tasks"),
    resolveModulePerms(userId, role, "team"),
  ]);

  const orgWide = hasOrgWideManage(role) || scope.all;

  const projectScope = orgWide
    ? {}
    : { id: { in: Array.from(scope.projectIds) } };
  const clientScope = orgWide
    ? {}
    : { id: { in: Array.from(scope.clientIds) } };
  // Contracts are scoped via the parent client/project relation
  // (matching how the Contracts list page filters).
  const contractScope = orgWide
    ? {}
    : {
        OR: [
          { clientId: { in: Array.from(scope.clientIds) } },
          { projectId: { in: Array.from(scope.projectIds) } },
        ],
      };
  // Tasks are scoped via the parent project. A non-org-wide user
  // sees their assigned-or-created tasks, plus tasks on projects
  // they have scope on. Tasks with no project (org-wide tasks) are
  // visible to everyone with canView on the tasks module.
  const taskScope = orgWide
    ? {}
    : {
        OR: [
          { projectId: { in: Array.from(scope.projectIds) } },
          { projectId: null },
          { assigneeId: userId },
          { createdById: userId },
        ],
      };

  const contains = { contains: query, mode: "insensitive" as const };

  const [clients, projects, contracts, suppliers, subcontractors, partnerships, tasks, intranetResources, users] = await Promise.all([
    clientPerms.canView
      ? db.client.findMany({
          where: {
            deletedAt: null,
            AND: [clientScope, { OR: [{ name: contains }, { description: contains }] }],
          },
          take: 10,
        })
      : [],
    projectPerms.canView
      ? db.project.findMany({
          where: {
            deletedAt: null,
            AND: [projectScope, { OR: [{ name: contains }, { description: contains }] }],
          },
          include: { client: { select: { id: true, name: true } } },
          take: 10,
        })
      : [],
    contractPerms.canView
      ? db.contract.findMany({
          where: {
            deletedAt: null,
            AND: [contractScope, { OR: [{ title: contains }, { description: contains }] }],
          },
          include: { client: { select: { id: true, name: true } } },
          take: 10,
        })
      : [],
    supplierPerms.canView
      ? db.supplier.findMany({
          where: { deletedAt: null, OR: [{ name: contains }, { notes: contains }] },
          take: 10,
        })
      : [],
    subcontractorPerms.canView
      ? db.subcontractor.findMany({
          where: {
            deletedAt: null,
            OR: [
              { name: contains },
              { legalName: contains },
              { description: contains },
              { primaryContactName: contains },
              { primaryContactEmail: contains },
            ],
          },
          take: 10,
        })
      : [],
    partnershipPerms.canView
      ? db.partnership.findMany({
          where: {
            deletedAt: null,
            OR: [
              { name: contains },
              { legalName: contains },
              { description: contains },
              { industry: contains },
              { primaryContactName: contains },
              { primaryContactEmail: contains },
            ],
          },
          take: 10,
        })
      : [],
    tasksPerms.canView
      ? db.task.findMany({
          where: {
            deletedAt: null,
            AND: [taskScope, { OR: [{ title: contains }, { description: contains }] }],
          },
          include: {
            project: { select: { id: true, name: true } },
            client: { select: { id: true, name: true } },
            assignee: { select: { id: true, name: true } },
          },
          take: 10,
        })
      : [],
    // Intranet resources (Time Off, HR policies, handbooks, etc.) —
    // previously missing from search which caused the reported Time Off bug.
    intranetPerms.canView
      ? db.intranetResource.findMany({
          where: {
            deletedAt: null,
            published: true,
            OR: [{ title: contains }, { description: contains }, { content: contains }],
          },
          take: 10,
          orderBy: { updatedAt: "desc" },
        })
      : [],
    // Team members — gated by the team module canView (intentionally
    // open to GUEST in default config so org-wide directory works).
    teamPerms.canView
      ? db.user.findMany({
          where: {
            isActive: true,
            OR: [
              { name: contains },
              { email: contains },
              { jobTitle: contains },
              { department: contains },
            ],
          },
          select: { id: true, name: true, email: true, jobTitle: true, department: true, location: true },
          take: 10,
        })
      : [],
  ]);

  const totalResults =
    clients.length +
    projects.length +
    contracts.length +
    suppliers.length +
    subcontractors.length +
    partnerships.length +
    tasks.length +
    intranetResources.length +
    users.length;

  return (
    <div>
      <PageHeader
        title={`Search Results for "${query}"`}
        description={`${totalResults} result${totalResults !== 1 ? "s" : ""} found`}
      />

      <div className="space-y-6">
        {clients.length > 0 && (
          <div>
            <h2 className="text-lg font-semibold mb-3">Clients ({clients.length})</h2>
            <div className="space-y-2">
              {clients.map((client) => (
                <Link key={client.id} href={`/clients/${client.id}`}>
                  <Card className="hover:shadow-md transition-shadow">
                    <CardContent className="p-4 flex items-center justify-between">
                      <div>
                        <p className="font-medium">{client.name}</p>
                        {client.industry && <p className="text-sm text-muted-foreground">{client.industry}</p>}
                      </div>
                      <StatusBadge status={client.status} />
                    </CardContent>
                  </Card>
                </Link>
              ))}
            </div>
          </div>
        )}

        {projects.length > 0 && (
          <div>
            <h2 className="text-lg font-semibold mb-3">Projects ({projects.length})</h2>
            <div className="space-y-2">
              {projects.map((project) => (
                <Link key={project.id} href={`/projects/${project.id}`}>
                  <Card className="hover:shadow-md transition-shadow">
                    <CardContent className="p-4 flex items-center justify-between">
                      <div>
                        <p className="font-medium">{project.name}</p>
                        <p className="text-sm text-muted-foreground">{project.client.name}</p>
                      </div>
                      <StatusBadge status={project.status} />
                    </CardContent>
                  </Card>
                </Link>
              ))}
            </div>
          </div>
        )}

        {contracts.length > 0 && (
          <div>
            <h2 className="text-lg font-semibold mb-3">Contracts ({contracts.length})</h2>
            <div className="space-y-2">
              {contracts.map((contract) => (
                <Link key={contract.id} href={`/contracts/${contract.id}`}>
                  <Card className="hover:shadow-md transition-shadow">
                    <CardContent className="p-4 flex items-center justify-between">
                      <div>
                        <p className="font-medium">{contract.title}</p>
                        <p className="text-sm text-muted-foreground">{contract.client.name}</p>
                      </div>
                      <StatusBadge status={contract.status} />
                    </CardContent>
                  </Card>
                </Link>
              ))}
            </div>
          </div>
        )}

        {suppliers.length > 0 && (
          <div>
            <h2 className="text-lg font-semibold mb-3">Suppliers ({suppliers.length})</h2>
            <div className="space-y-2">
              {suppliers.map((supplier) => (
                <Link key={supplier.id} href={`/suppliers/${supplier.id}`}>
                  <Card className="hover:shadow-md transition-shadow">
                    <CardContent className="p-4 flex items-center justify-between">
                      <div>
                        <p className="font-medium">{supplier.name}</p>
                        <Badge variant="outline">{supplier.category}</Badge>
                      </div>
                      <StatusBadge status={supplier.status} />
                    </CardContent>
                  </Card>
                </Link>
              ))}
            </div>
          </div>
        )}

        {subcontractors.length > 0 && (
          <div>
            <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
              <HardHat className="h-4 w-4" />
              Subcontractors ({subcontractors.length})
            </h2>
            <div className="space-y-2">
              {subcontractors.map((sub) => (
                <Link key={sub.id} href={`/subcontractors/${sub.id}`}>
                  <Card className="hover:shadow-md transition-shadow">
                    <CardContent className="p-4 flex items-center justify-between">
                      <div>
                        <p className="font-medium">{sub.name}</p>
                        {sub.primaryContactName && (
                          <p className="text-sm text-muted-foreground">{sub.primaryContactName}</p>
                        )}
                      </div>
                      <StatusBadge status={sub.status} />
                    </CardContent>
                  </Card>
                </Link>
              ))}
            </div>
          </div>
        )}

        {partnerships.length > 0 && (
          <div>
            <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
              <Handshake className="h-4 w-4" />
              Partnerships ({partnerships.length})
            </h2>
            <div className="space-y-2">
              {partnerships.map((p) => (
                <Link key={p.id} href={`/partnerships/${p.id}`}>
                  <Card className="hover:shadow-md transition-shadow">
                    <CardContent className="p-4 flex items-center justify-between">
                      <div>
                        <p className="font-medium">{p.name}</p>
                        <p className="text-sm text-muted-foreground">
                          {p.type.replace("_", " ").toLowerCase()}
                          {p.industry ? ` · ${p.industry}` : ""}
                        </p>
                      </div>
                      <StatusBadge status={p.status} />
                    </CardContent>
                  </Card>
                </Link>
              ))}
            </div>
          </div>
        )}

        {tasks.length > 0 && (
          <div>
            <h2 className="text-lg font-semibold mb-3">Tasks ({tasks.length})</h2>
            <div className="space-y-2">
              {tasks.map((task) => {
                // Deep-link task results to the parent context when possible:
                // project page > client page > global tasks list.
                const href = task.project
                  ? `/projects/${task.project.id}`
                  : task.client
                    ? `/clients/${task.client.id}`
                    : "/tasks";
                return (
                  <Link key={task.id} href={href}>
                    <Card className="hover:shadow-md transition-shadow">
                      <CardContent className="p-4 flex items-center justify-between">
                        <div>
                          <p className="font-medium">{task.title}</p>
                          <p className="text-sm text-muted-foreground">
                            {[task.project?.name, task.client?.name, task.assignee?.name].filter(Boolean).join(" · ")}
                          </p>
                        </div>
                        <Badge variant={task.status === "DONE" ? "success" : "outline"}>{task.status.replace("_", " ")}</Badge>
                      </CardContent>
                    </Card>
                  </Link>
                );
              })}
            </div>
          </div>
        )}

        {users.length > 0 && (
          <div>
            <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
              <Users className="h-4 w-4" />
              Team ({users.length})
            </h2>
            <div className="space-y-2">
              {users.map((u) => (
                <Link key={u.id} href={`/team/${u.id}`}>
                  <Card className="hover:shadow-md transition-shadow">
                    <CardContent className="p-4 flex items-center justify-between">
                      <div>
                        <p className="font-medium">{u.name}</p>
                        <p className="text-sm text-muted-foreground">
                          {[u.jobTitle, u.department, u.location].filter(Boolean).join(" · ") || u.email}
                        </p>
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              ))}
            </div>
          </div>
        )}

        {intranetResources.length > 0 && (
          <div>
            <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
              <BookOpen className="h-4 w-4" />
              Intranet ({intranetResources.length})
            </h2>
            <div className="space-y-2">
              {intranetResources.map((r) => (
                <Link key={r.id} href={`/intranet/${r.id}`}>
                  <Card className="hover:shadow-md transition-shadow">
                    <CardContent className="p-4 flex items-center justify-between">
                      <div>
                        <p className="font-medium">{r.title}</p>
                        {r.description && (
                          <p className="text-sm text-muted-foreground line-clamp-1">{r.description}</p>
                        )}
                      </div>
                      <Badge variant="outline">{r.category.replace(/_/g, " ")}</Badge>
                    </CardContent>
                  </Card>
                </Link>
              ))}
            </div>
          </div>
        )}

        {totalResults === 0 && (
          <div className="text-center py-12 text-muted-foreground">
            <Search className="h-12 w-12 mx-auto mb-4" />
            <p>No results found for &quot;{query}&quot;</p>
          </div>
        )}
      </div>
    </div>
  );
}
