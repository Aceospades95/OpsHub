import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { resolveModulePerms } from "@/lib/permissions";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { StatusBadge } from "@/components/shared/status-badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Badge } from "@/components/ui/badge";
import { FileText } from "lucide-react";
import { format } from "date-fns";
import Link from "next/link";
import { ContractCreateButton } from "./contract-create-button";

export default async function ContractsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const perms = await resolveModulePerms(session.user.id, session.user.role, "contracts");
  if (!perms.canView) redirect("/dashboard");

  const contracts = await db.contract.findMany({
    orderBy: { updatedAt: "desc" },
    include: {
      client: { select: { name: true } },
      project: { select: { name: true } },
    },
  });

  const clients = await db.client.findMany({
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  const projects = await db.project.findMany({
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  return (
    <div>
      <PageHeader
        title="Contracts"
        description="Manage contracts and agreements"
        actions={
          perms.canCreate ? (
            <ContractCreateButton clients={clients} projects={projects} parentContracts={contracts} />
          ) : undefined
        }
      />

      {contracts.length === 0 ? (
        <EmptyState icon={FileText} title="No contracts yet" description="Create your first contract" />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {contracts.map((contract) => (
            <Link key={contract.id} href={`/contracts/${contract.id}`}>
              <Card className="hover:shadow-md transition-shadow h-full">
                <CardContent className="p-5">
                  <div className="flex items-start justify-between mb-2">
                    <h3 className="font-semibold text-foreground text-sm">{contract.title}</h3>
                    <StatusBadge status={contract.status} />
                  </div>
                  <p className="text-sm text-muted-foreground">{contract.client.name}</p>
                  {contract.project && (
                    <p className="text-xs text-muted-foreground">{contract.project.name}</p>
                  )}
                  <div className="flex items-center gap-2 mt-3">
                    {contract.contractType && (
                      <Badge variant="outline">{contract.contractType}</Badge>
                    )}
                    {contract.value && (
                      <span className="text-sm font-medium">
                        {contract.currency || "USD"} {contract.value.toLocaleString()}
                      </span>
                    )}
                  </div>
                  {(contract.startDate || contract.endDate) && (
                    <p className="text-xs text-muted-foreground mt-2">
                      {contract.startDate && format(contract.startDate, "MMM d, yyyy")}
                      {contract.startDate && contract.endDate && " — "}
                      {contract.endDate && format(contract.endDate, "MMM d, yyyy")}
                    </p>
                  )}
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
