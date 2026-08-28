import { db } from "@/lib/db";
import { Suspense } from "react";
import { requireAuth, resolveModulePerms } from "@/lib/permissions";
import { DownloadCsvButton } from "@/components/shared/download-csv-button";
import { pluralize } from "@/lib/pluralize";
import { getUserScope } from "@/lib/scope";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { StatusBadge } from "@/components/shared/status-badge";
import { EmptyState } from "@/components/ui/empty-state";
import { AccessDenied } from "@/components/shared/access-denied";
import { Building2 } from "lucide-react";
import Link from "next/link";
import { ClientCreateButton } from "./client-create-button";
import { ClientFilters } from "./client-filters";
import { Prisma } from "@prisma/client";
import { resolveViewPreference } from "@/lib/view-preference";
import { ViewOptionsBar } from "@/components/shared/view-options-bar";
import { GroupSection } from "@/components/shared/group-section";
import { groupRows } from "@/lib/group-rows";

const GROUP_OPTIONS = [
  { value: "status", label: "Status" },
  { value: "industry", label: "Industry" },
  { value: "accountManager", label: "Account manager" },
] as const;
type GroupKey = (typeof GROUP_OPTIONS)[number]["value"];

export const metadata = { title: "Clients · OpsHub" };

export default async function ClientsPage({
  searchParams,
}: {
  searchParams: { status?: string; sort?: string; view?: string; groupBy?: string };
}) {
  const user = await requireAuth();

  const perms = await resolveModulePerms(user.id, user.role, "clients");
  if (!perms.canView) return <AccessDenied module="clients" moduleLabel="Clients" moduleDescription="Client accounts, contacts, and relationships" />;

  const statusFilter = searchParams.status;
  const sortParam = searchParams.sort;
  const view = resolveViewPreference(searchParams.view, "clients", ["table", "cards"], "table");
  const groupBy = GROUP_OPTIONS.some((o) => o.value === searchParams.groupBy)
    ? (searchParams.groupBy as GroupKey)
    : null;

  const scope = await getUserScope(user.id, user.role);

  // Build where clause
  const where: Prisma.ClientWhereInput = { deletedAt: null };
  if (statusFilter && ["ACTIVE", "INACTIVE", "PROSPECT", "ARCHIVED"].includes(statusFilter)) {
    where.status = statusFilter as "ACTIVE" | "INACTIVE" | "PROSPECT" | "ARCHIVED";
  }
  if (!scope.all) {
    where.id = { in: Array.from(scope.clientIds) };
  }

  // Build orderBy
  let orderBy: Prisma.ClientOrderByWithRelationInput | Prisma.ClientOrderByWithRelationInput[];
  switch (sortParam) {
    case "name-asc":
      orderBy = { name: "asc" };
      break;
    case "name-desc":
      orderBy = { name: "desc" };
      break;
    case "projects":
      orderBy = { projects: { _count: "desc" } };
      break;
    default:
      orderBy = { updatedAt: "desc" };
  }

  const clients = await db.client.findMany({
    where,
    orderBy,
    include: {
      accountManager: { select: { id: true, name: true } },
      _count: {
        select: {
          projects: { where: { deletedAt: null } },
          contracts: { where: { deletedAt: null } },
        },
      },
    },
  });

  // People counts come from the unified rolodex (ContactLink is
  // polymorphic, so it can't ride in _count). The legacy ClientContact
  // table is frozen — counting it would drift as the rolodex is edited.
  const contactLinkCounts = await db.contactLink.groupBy({
    by: ["entityId"],
    where: {
      entityType: "client",
      entityId: { in: clients.map((c) => c.id) },
      contact: { deletedAt: null },
    },
    _count: { _all: true },
  });
  const contactCountByClient = new Map(
    contactLinkCounts.map((r) => [r.entityId, r._count._all])
  );

  type ClientRow = (typeof clients)[number];
  const groupKeyOf = (client: ClientRow, key: GroupKey): string | null => {
    switch (key) {
      case "status":
        return client.status.charAt(0) + client.status.slice(1).toLowerCase();
      case "industry":
        return client.industry;
      case "accountManager":
        return client.accountManager?.name ?? null;
    }
  };

  const renderCards = (rows: ClientRow[]) => (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {rows.map((client) => (
        <Link key={client.id} href={`/clients/${client.slug ?? client.id}`}>
          <Card className="hover:shadow-md transition-shadow h-full">
            <CardContent className="p-5">
              <div className="flex items-start justify-between mb-2">
                <h3 className="font-semibold text-foreground">{client.name}</h3>
                <StatusBadge status={client.status} />
              </div>
              <p className="text-sm text-muted-foreground mb-3">
                {client.industry || (
                  <span className="italic opacity-60">No industry set</span>
                )}
              </p>
              <div className="flex gap-4 text-xs text-muted-foreground">
                <span>{pluralize(client._count.projects, "project")}</span>
                <span>{pluralize(client._count.contracts, "contract")}</span>
                <span>{pluralize(contactCountByClient.get(client.id) ?? 0, "contact")}</span>
              </div>
            </CardContent>
          </Card>
        </Link>
      ))}
    </div>
  );

  const renderTable = (rows: ClientRow[]) => (
    <Card>
      <CardContent className="p-0 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted-foreground">
              <th className="p-3 font-medium">Name</th>
              <th className="p-3 font-medium">Industry</th>
              <th className="p-3 font-medium">Status</th>
              <th className="p-3 font-medium">Account manager</th>
              <th className="p-3 font-medium text-right">Projects</th>
              <th className="p-3 font-medium text-right">Contracts</th>
              <th className="p-3 font-medium text-right">Contacts</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((client) => (
              <tr key={client.id} className="border-b border-border last:border-0 hover:bg-muted/50">
                <td className="p-3">
                  <Link
                    href={`/clients/${client.slug ?? client.id}`}
                    className="font-medium hover:text-primary hover:underline"
                  >
                    {client.name}
                  </Link>
                </td>
                <td className="p-3 text-muted-foreground">{client.industry || "—"}</td>
                <td className="p-3"><StatusBadge status={client.status} /></td>
                <td className="p-3 text-muted-foreground">
                  {client.accountManager ? (
                    <Link href={`/team/${client.accountManager.id}`} className="hover:text-primary hover:underline">
                      {client.accountManager.name}
                    </Link>
                  ) : (
                    "—"
                  )}
                </td>
                <td className="p-3 text-right tabular-nums">{client._count.projects}</td>
                <td className="p-3 text-right tabular-nums">{client._count.contracts}</td>
                <td className="p-3 text-right tabular-nums">{contactCountByClient.get(client.id) ?? 0}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );

  const renderRows = view === "table" ? renderTable : renderCards;
  const groups = groupBy ? groupRows(clients, (c) => groupKeyOf(c, groupBy)) : null;

  return (
    <div>
      <PageHeader
        title="Clients"
        description="Manage your client portfolio"
        actions={
          <div className="flex items-center gap-2">
            {user.role === "ADMIN" && <DownloadCsvButton importerKey="clients" />}
            {perms.canCreate && <ClientCreateButton />}
          </div>
        }
      />

      <Suspense fallback={null}>
        <ClientFilters
          currentStatus={statusFilter}
          currentSort={sortParam}
          resultCount={clients.length}
        />
      </Suspense>

      <Suspense fallback={null}>
        <ViewOptionsBar
          view={view}
          viewOptions={[
            { value: "table", label: "Table" },
            { value: "cards", label: "Cards" },
          ]}
          storageKey="clients"
          groupBy={groupBy}
          groupByOptions={[...GROUP_OPTIONS]}
        />
      </Suspense>

      {clients.length === 0 ? (
        <EmptyState
          icon={Building2}
          title="No clients yet"
          description={statusFilter ? "No clients match the current filter" : "Add your first client to get started"}
        />
      ) : groups ? (
        groups.map((group) => (
          <GroupSection key={group.label} label={group.label} count={group.rows.length}>
            {renderRows(group.rows)}
          </GroupSection>
        ))
      ) : (
        renderRows(clients)
      )}
    </div>
  );
}
