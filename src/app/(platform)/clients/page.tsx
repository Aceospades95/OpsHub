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

export default async function ClientsPage({
  searchParams,
}: {
  searchParams: { status?: string; sort?: string };
}) {
  const user = await requireAuth();

  const perms = await resolveModulePerms(user.id, user.role, "clients");
  if (!perms.canView) return <AccessDenied module="clients" moduleLabel="Clients" moduleDescription="Client accounts, contacts, and relationships" />;

  const statusFilter = searchParams.status;
  const sortParam = searchParams.sort;

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
      _count: {
        select: {
          projects: { where: { deletedAt: null } },
          contracts: { where: { deletedAt: null } },
          contacts: true,
        },
      },
    },
  });

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

      {clients.length === 0 ? (
        <EmptyState
          icon={Building2}
          title="No clients yet"
          description={statusFilter ? "No clients match the current filter" : "Add your first client to get started"}
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {clients.map((client) => (
            <Link key={client.id} href={`/clients/${client.id}`}>
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
                    <span>{pluralize(client._count.contacts, "contact")}</span>
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
