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

export default async function ClientsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const perms = await resolveModulePerms(session.user.id, session.user.role, "clients");
  if (!perms.canView) redirect("/dashboard");

  const clients = await db.client.findMany({
    orderBy: { updatedAt: "desc" },
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

      {clients.length === 0 ? (
        <EmptyState
          icon={Building2}
          title="No clients yet"
          description="Add your first client to get started"
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
