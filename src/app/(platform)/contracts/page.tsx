import { db } from "@/lib/db";
import { requireAuth, resolveModulePerms } from "@/lib/permissions";
import { getUserScope } from "@/lib/scope";
import { AccessDenied } from "@/components/shared/access-denied";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { TreeView, TreeNode } from "@/components/shared/tree-view";
import { FileText } from "lucide-react";
import { ContractCreateButton } from "./contract-create-button";
import { DownloadCsvButton } from "@/components/shared/download-csv-button";

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
  const user = await requireAuth();

  const perms = await resolveModulePerms(user.id, user.role, "contracts");
  if (!perms.canView) return <AccessDenied module="contracts" moduleLabel="Contracts" moduleDescription="Contracts, SOWs, amendments, and renewals" />;

  const scope = await getUserScope(user.id, user.role);
  const scopedContractIds = scope.all ? null : Array.from(scope.contractIds);
  const scopedClientIds = scope.all ? null : Array.from(scope.clientIds);
  const scopedProjectIds = scope.all ? null : Array.from(scope.projectIds);

  const clients = await db.client.findMany({
    where: { deletedAt: null, ...(scopedClientIds ? { id: { in: scopedClientIds } } : {}) },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  const projects = await db.project.findMany({
    where: { deletedAt: null, ...(scopedProjectIds ? { id: { in: scopedProjectIds } } : {}) },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  const parentContracts = await db.contract.findMany({
    where: { deletedAt: null, ...(scopedContractIds ? { id: { in: scopedContractIds } } : {}) },
    select: { id: true, title: true },
    orderBy: { title: "asc" },
  });

  // Hierarchical query: root contracts grouped by client
  const rootContracts = await db.contract.findMany({
    where: {
      deletedAt: null,
      parentContractId: null,
      ...(scopedContractIds ? { id: { in: scopedContractIds } } : {}),
    },
    orderBy: { updatedAt: "desc" },
    include: {
      client: { select: { id: true, name: true } },
      childContracts: {
        where: { deletedAt: null },
        include: {
          client: { select: { id: true, name: true } },
          childContracts: {
            where: { deletedAt: null },
            include: {
              client: { select: { id: true, name: true } },
              childContracts: {
                where: { deletedAt: null },
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
          <div className="flex items-center gap-2">
            {user.role === "ADMIN" && <DownloadCsvButton importerKey="contracts" />}
            {perms.canCreate && (
              <ContractCreateButton clients={clients} projects={projects} parentContracts={parentContracts} />
            )}
          </div>
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
