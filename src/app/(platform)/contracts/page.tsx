import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { resolveModulePerms } from "@/lib/permissions";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { TreeView, TreeNode } from "@/components/shared/tree-view";
import { FileText } from "lucide-react";
import { ContractCreateButton } from "./contract-create-button";

interface ContractWithRelations {
  id: string;
  title: string;
  status: string;
  contractType: string | null;
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

export default async function ContractsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const perms = await resolveModulePerms(session.user.id, session.user.role, "contracts");
  if (!perms.canView) redirect("/dashboard");

  const clients = await db.client.findMany({
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  const projects = await db.project.findMany({
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  const parentContracts = await db.contract.findMany({
    select: { id: true, title: true },
    orderBy: { title: "asc" },
  });

  // Hierarchical query: root contracts grouped by client
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
              childContracts: {
                include: { client: { select: { id: true, name: true } } },
              },
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

  const clientTreeNodes: TreeNode[] = Array.from(clientMap.values()).map((client) => ({
    id: client.id,
    label: client.name,
    href: `/clients/${client.id}`,
    children: buildContractTreeNodes(client.contracts),
  }));

  return (
    <div>
      <PageHeader
        title="Contracts"
        description="Manage contracts and agreements"
        actions={
          perms.canCreate ? (
            <ContractCreateButton clients={clients} projects={projects} parentContracts={parentContracts} />
          ) : undefined
        }
      />

      {rootContracts.length === 0 ? (
        <EmptyState icon={FileText} title="No contracts yet" description="Create your first contract" />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              Contract Hierarchy
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2 px-2 py-2 mb-2 border-b text-xs font-semibold uppercase tracking-wider text-muted-foreground" style={{ borderColor: "color-mix(in srgb, var(--foreground) 10%, transparent)" }}>
              <span className="w-6" />
              <span className="flex-1">Contract</span>
              <span className="w-24 text-center">Status</span>
              <span className="w-32 text-right">Type</span>
            </div>
            <TreeView nodes={clientTreeNodes} />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
