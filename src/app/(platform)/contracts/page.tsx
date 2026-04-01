import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { resolveModulePerms } from "@/lib/permissions";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/shared/status-badge";
import { EmptyState } from "@/components/ui/empty-state";
import { TreeView, TreeNode } from "@/components/shared/tree-view";
import { Badge } from "@/components/ui/badge";
import { FileText, AlertTriangle, Clock } from "lucide-react";
import { format, differenceInDays } from "date-fns";
import Link from "next/link";
import { ContractCreateButton } from "./contract-create-button";
import { ContractViewToggle } from "./contract-view-toggle";

interface ContractWithRelations {
  id: string;
  title: string;
  status: string;
  contractType: string | null;
  value: number | null;
  currency: string | null;
  startDate: Date | null;
  endDate: Date | null;
  client: { id: string; name: string };
  childContracts: ContractWithRelations[];
}

function buildContractTreeNodes(contracts: ContractWithRelations[]): TreeNode[] {
  return contracts.map((contract) => ({
    id: contract.id,
    label: contract.title,
    href: `/contracts/${contract.id}`,
    status: contract.status,
    meta: contract.contractType || undefined,
    children: contract.childContracts.length > 0
      ? buildContractTreeNodes(contract.childContracts)
      : undefined,
  }));
}

export default async function ContractsPage({
  searchParams,
}: {
  searchParams: { view?: string };
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const perms = await resolveModulePerms(session.user.id, session.user.role, "contracts");
  if (!perms.canView) redirect("/dashboard");

  const view = searchParams.view || "cards";

  // Card view: flat query with SLA/risk data (existing behavior)
  const contracts = await db.contract.findMany({
    orderBy: { updatedAt: "desc" },
    include: {
      client: { select: { id: true, name: true } },
      project: { select: { name: true } },
      terms: {
        where: { type: "SLA" },
        select: { id: true, title: true, priority: true },
      },
      _count: { select: { terms: true } },
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

  // Tree view: hierarchical query for root contracts with nested children
  let clientTreeNodes: TreeNode[] = [];
  if (view === "tree") {
    const rootContracts = await db.contract.findMany({
      where: { parentContractId: null },
      orderBy: { updatedAt: "desc" },
      include: {
        client: { select: { id: true, name: true } },
        childContracts: {
          include: {
            client: { select: { id: true, name: true } },
            childContracts: {
              include: {
                client: { select: { id: true, name: true } },
              },
            },
          },
        },
      },
    });

    // Group by client
    const clientMap = new Map<string, { id: string; name: string; contracts: ContractWithRelations[] }>();
    for (const contract of rootContracts) {
      const clientId = contract.client.id;
      if (!clientMap.has(clientId)) {
        clientMap.set(clientId, { id: clientId, name: contract.client.name, contracts: [] });
      }
      clientMap.get(clientId)!.contracts.push(contract as unknown as ContractWithRelations);
    }

    clientTreeNodes = Array.from(clientMap.values()).map((client) => ({
      id: client.id,
      label: client.name,
      href: `/clients/${client.id}`,
      children: buildContractTreeNodes(client.contracts),
    }));
  }

  const now = new Date();

  return (
    <div>
      <PageHeader
        title="Contracts"
        description="Manage contracts and agreements"
        actions={
          <div className="flex items-center gap-2">
            <ContractViewToggle currentView={view} />
            {perms.canCreate && (
              <ContractCreateButton clients={clients} projects={projects} parentContracts={contracts} />
            )}
          </div>
        }
      />

      {contracts.length === 0 ? (
        <EmptyState icon={FileText} title="No contracts yet" description="Create your first contract" />
      ) : view === "tree" ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              Contract Hierarchy
            </CardTitle>
          </CardHeader>
          <CardContent>
            <TreeView nodes={clientTreeNodes} />
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {contracts.map((contract) => {
            const daysUntilEnd = contract.endDate
              ? differenceInDays(contract.endDate, now)
              : null;
            const isExpiringSoon = daysUntilEnd !== null && daysUntilEnd > 0 && daysUntilEnd <= 90;
            const isExpired = daysUntilEnd !== null && daysUntilEnd <= 0;
            const slaCount = contract.terms.length;
            const highPrioritySLAs = contract.terms.filter((t) => t.priority === "HIGH").length;

            return (
              <Link key={contract.id} href={`/contracts/${contract.id}`}>
                <Card className={`hover:shadow-md transition-shadow h-full ${isExpired ? "border-destructive/50" : isExpiringSoon ? "border-warning/50" : ""}`}>
                  <CardContent className="p-5">
                    <div className="flex items-start justify-between mb-2">
                      <h3 className="font-semibold text-foreground text-sm">{contract.title}</h3>
                      <StatusBadge status={contract.status} />
                    </div>
                    <p className="text-sm text-muted-foreground">{contract.client.name}</p>
                    {contract.project && (
                      <p className="text-xs text-muted-foreground">{contract.project.name}</p>
                    )}
                    <div className="flex items-center gap-2 mt-3 flex-wrap">
                      {contract.contractType && (
                        <Badge variant="outline">{contract.contractType}</Badge>
                      )}
                      {contract.value && (
                        <span className="text-sm font-medium">
                          {contract.currency || "USD"} {contract.value.toLocaleString()}
                        </span>
                      )}
                    </div>

                    {/* Risk / SLA indicators */}
                    <div className="flex items-center gap-3 mt-3 pt-3 border-t border-border text-xs">
                      {isExpired && (
                        <span className="flex items-center gap-1 text-destructive font-medium">
                          <AlertTriangle className="h-3 w-3" /> Expired
                        </span>
                      )}
                      {isExpiringSoon && (
                        <span className="flex items-center gap-1 text-yellow-600 font-medium">
                          <Clock className="h-3 w-3" /> {daysUntilEnd}d remaining
                        </span>
                      )}
                      {!isExpired && !isExpiringSoon && contract.endDate && (
                        <span className="text-muted-foreground">
                          Ends {format(contract.endDate, "MMM d, yyyy")}
                        </span>
                      )}
                      {slaCount > 0 && (
                        <span className={`font-medium ${highPrioritySLAs > 0 ? "text-red-600" : "text-muted-foreground"}`}>
                          {slaCount} SLA{slaCount !== 1 ? "s" : ""}
                          {highPrioritySLAs > 0 && ` (${highPrioritySLAs} high)`}
                        </span>
                      )}
                      {contract._count.terms > 0 && slaCount === 0 && (
                        <span className="text-muted-foreground">
                          {contract._count.terms} terms
                        </span>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
