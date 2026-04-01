import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { resolveModulePerms } from "@/lib/permissions";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { StatusBadge } from "@/components/shared/status-badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Badge } from "@/components/ui/badge";
import { FileText, AlertTriangle, Clock } from "lucide-react";
import { format, differenceInDays } from "date-fns";
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

  const now = new Date();

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
