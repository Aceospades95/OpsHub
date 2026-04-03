import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { resolveModulePerms } from "@/lib/permissions";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { StatusBadge } from "@/components/shared/status-badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Building2 } from "lucide-react";
import Link from "next/link";
import { ClientCreateButton } from "./client-create-button";
import { ClientFilters } from "./client-filters";
import { Prisma } from "@prisma/client";

export default async function ClientsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; sort?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const perms = await resolveModulePerms(session.user.id, session.user.role, "clients");
  if (!perms.canView) redirect("/dashboard");

  const params = await searchParams;
  const statusFilter = params.status;
  const sortParam = params.sort;

  // Build where clause
  const where: Prisma.ClientWhereInput = {};
  if (statusFilter && ["ACTIVE", "INACTIVE", "PROSPECT", "ARCHIVED"].includes(statusFilter)) {
    where.status = statusFilter as "ACTIVE" | "INACTIVE" | "PROSPECT" | "ARCHIVED";
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
      _count: { select: { projects: true, contracts: true, contacts: true } },
    },
  });

  return (
    <div>
      <PageHeader
        title="Clients"
        description="Manage your client portfolio"
        actions={perms.canCreate ? <ClientCreateButton /> : undefined}
      />

      <ClientFilters
        currentStatus={statusFilter}
        currentSort={sortParam}
        resultCount={clients.length}
      />

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
                  {client.industry && (
                    <p className="text-sm text-muted-foreground mb-3">{client.industry}</p>
                  )}
                  <div className="flex gap-4 text-xs text-muted-foreground">
                    <span>{client._count.projects} projects</span>
                    <span>{client._count.contracts} contracts</span>
                    <span>{client._count.contacts} contacts</span>
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
