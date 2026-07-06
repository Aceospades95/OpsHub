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
import Link from "next/link";
import { StatusBadge } from "@/components/shared/status-badge";
import { formatCalendarDate } from "@/lib/dates";
import { effectiveContractStatus } from "@/lib/effective-status";
import { ViewOptionsBar } from "@/components/shared/view-options-bar";
import { GroupSection } from "@/components/shared/group-section";
import { groupRows } from "@/lib/group-rows";

const GROUP_OPTIONS = [
  { value: "client", label: "Client" },
  { value: "status", label: "Status" },
  { value: "type", label: "Type" },
] as const;
type GroupKey = (typeof GROUP_OPTIONS)[number]["value"];

function humanizeEnum(value: string): string {
  return value
    .split("_")
    .map((w) => w.charAt(0) + w.slice(1).toLowerCase())
    .join(" ");
}

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

export const metadata = { title: "Contracts · OpsHub" };

export default async function ContractsPage({
  searchParams,
}: {
  searchParams: { client?: string; view?: string; groupBy?: string };
}) {
  const user = await requireAuth();

  const perms = await resolveModulePerms(user.id, user.role, "contracts");
  if (!perms.canView) return <AccessDenied module="contracts" moduleLabel="Contracts" moduleDescription="Contracts, SOWs, amendments, and renewals" />;

  // Optional ?client=<id> filter — used by the client detail page's
  // "Create one →" link so the tree opens scoped to that client.
  const clientFilter = searchParams.client;
  const view = searchParams.view === "table" ? "table" : "tree";
  const groupBy = GROUP_OPTIONS.some((o) => o.value === searchParams.groupBy)
    ? (searchParams.groupBy as GroupKey)
    : null;

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
  // Flat list for the table view (amendments included as rows; the tree
  // view nests them instead). Only fetched when the table is showing.
  const flatContracts =
    view === "table"
      ? await db.contract.findMany({
          where: {
            deletedAt: null,
            ...(scopedContractIds ? { id: { in: scopedContractIds } } : {}),
            ...(clientFilter ? { clientId: clientFilter } : {}),
          },
          orderBy: [{ client: { name: "asc" } }, { title: "asc" }],
          include: {
            client: { select: { id: true, name: true } },
            project: { select: { id: true, name: true } },
          },
        })
      : [];

  const rootContracts = await db.contract.findMany({
    where: {
      deletedAt: null,
      parentContractId: null,
      ...(scopedContractIds ? { id: { in: scopedContractIds } } : {}),
      ...(clientFilter ? { clientId: clientFilter } : {}),
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

      <ViewOptionsBar
        view={view}
        viewOptions={[
          { value: "tree", label: "Tree" },
          { value: "table", label: "Table" },
        ]}
        groupBy={view === "table" ? groupBy : undefined}
        groupByOptions={view === "table" ? [...GROUP_OPTIONS] : undefined}
      />

      {view === "table" ? (
        flatContracts.length === 0 ? (
          <EmptyState icon={FileText} title="No contracts yet" description="Create your first contract" />
        ) : (
          (() => {
            const now = new Date();
            type FlatContract = (typeof flatContracts)[number];
            const groupKeyOf = (contract: FlatContract, key: GroupKey): string | null => {
              switch (key) {
                case "client":
                  return contract.client.name;
                case "status":
                  return humanizeEnum(effectiveContractStatus(contract, now));
                case "type":
                  return contract.contractType ? humanizeEnum(contract.contractType) : null;
              }
            };
            const renderTable = (rows: FlatContract[]) => (
              <Card>
                <CardContent className="p-0 overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border text-left text-xs text-muted-foreground">
                        <th className="p-3 font-medium">Contract</th>
                        <th className="p-3 font-medium">Client</th>
                        <th className="p-3 font-medium">Project</th>
                        <th className="p-3 font-medium">Type</th>
                        <th className="p-3 font-medium text-right">Value</th>
                        <th className="p-3 font-medium">Ends</th>
                        <th className="p-3 font-medium">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((contract) => (
                        <tr key={contract.id} className="border-b border-border last:border-0 hover:bg-muted/50">
                          <td className="p-3">
                            <Link href={`/contracts/${contract.id}`} className="font-medium hover:text-primary hover:underline">
                              {contract.title}
                            </Link>
                            {contract.contractNumber && (
                              <div className="text-xs text-muted-foreground">#{contract.contractNumber}</div>
                            )}
                          </td>
                          <td className="p-3 text-muted-foreground">
                            <Link href={`/clients/${contract.client.id}`} className="hover:text-primary hover:underline">
                              {contract.client.name}
                            </Link>
                          </td>
                          <td className="p-3 text-muted-foreground">
                            {contract.project ? (
                              <Link href={`/projects/${contract.project.id}`} className="hover:text-primary hover:underline">
                                {contract.project.name}
                              </Link>
                            ) : (
                              "—"
                            )}
                          </td>
                          <td className="p-3 text-muted-foreground">
                            {contract.contractType ? humanizeEnum(contract.contractType) : "—"}
                          </td>
                          <td className="p-3 text-right tabular-nums text-muted-foreground">
                            {contract.value
                              ? `${contract.currency || "USD"} ${contract.value.toLocaleString()}`
                              : "—"}
                          </td>
                          <td className="p-3 text-muted-foreground">
                            {contract.endDate ? formatCalendarDate(contract.endDate, "MMM d, yyyy") : "—"}
                          </td>
                          <td className="p-3">
                            {/* Date-derived — the stored EXPIRING_SOON/EXPIRED
                             *  enum values are only as fresh as the daily job. */}
                            <StatusBadge status={effectiveContractStatus(contract, now)} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </CardContent>
              </Card>
            );
            const groups = groupBy ? groupRows(flatContracts, (row) => groupKeyOf(row, groupBy)) : null;
            return groups ? (
              groups.map((group) => (
                <GroupSection key={group.label} label={group.label} count={group.rows.length}>
                  {renderTable(group.rows)}
                </GroupSection>
              ))
            ) : (
              renderTable(flatContracts)
            );
          })()
        )
      ) : rootContracts.length === 0 ? (
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
