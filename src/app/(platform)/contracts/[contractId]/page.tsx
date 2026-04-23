import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireAuth, resolveModulePerms } from "@/lib/permissions";
import { getUserScope, canViewEntity } from "@/lib/scope";
import { AccessDenied } from "@/components/shared/access-denied";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/shared/status-badge";
import { CommentSection } from "@/components/shared/comment-section";
import { FileList } from "@/components/shared/file-list";
import { TreeView, type TreeNode } from "@/components/shared/tree-view";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";
import Link from "next/link";
import { ContractActions } from "./contract-actions";
import { TermSection } from "./term-section";
import { ContractAttachments } from "./contract-attachments";
import { ContractCreateButton } from "../contract-create-button";
import { PageLayout } from "@/components/shared/page-layout";

interface Props {
  params: Promise<{ contractId: string }>;
}

export default async function ContractDetailPage({ params }: Props) {
  const { contractId } = await params;
  const user = await requireAuth();

  const canEditLayout = user.role === "ADMIN" || user.role === "DEVELOPER";

  const perms = await resolveModulePerms(user.id, user.role, "contracts");
  if (!perms.canView) return <AccessDenied module="contracts" moduleLabel="Contracts" moduleDescription="Contracts, SOWs, amendments, and renewals" />;

  const contract = await db.contract.findUnique({
    where: { id: contractId },
    include: {
      client: { select: { id: true, name: true } },
      project: { select: { id: true, name: true } },
      parentContract: { select: { id: true, title: true } },
      childContracts: { select: { id: true, title: true, status: true, contractType: true } },
      terms: { orderBy: [{ priority: "asc" }, { createdAt: "desc" }] },
      links: true,
      embeds: true,
      comments: {
        include: { author: { select: { id: true, name: true } } },
        orderBy: { createdAt: "desc" },
      },
    },
  });

  if (!contract) notFound();

  const scope = await getUserScope(user.id, user.role);
  if (!canViewEntity(scope, "contract", contract.id)) notFound();

  const clients = await db.client.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } });
  const projects = await db.project.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } });
  const allContracts = await db.contract.findMany({ select: { id: true, title: true }, orderBy: { title: "asc" } });

  const childNodes: TreeNode[] = contract.childContracts.map((c) => ({
    id: c.id,
    label: c.title,
    href: `/contracts/${c.id}`,
    status: c.status,
    meta: c.contractType || undefined,
  }));

  const cardMap: Record<string, React.ReactNode> = {
    details: (
      <Card className="h-full">
        <CardHeader>
          <CardTitle>Contract Details</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-4 text-sm">
            {contract.value && (
              <div>
                <p className="text-muted-foreground">Value</p>
                <p className="font-medium">{contract.currency || "USD"} {contract.value.toLocaleString()}</p>
              </div>
            )}
            {contract.startDate && (
              <div>
                <p className="text-muted-foreground">Start Date</p>
                <p className="font-medium">{format(contract.startDate, "MMM d, yyyy")}</p>
              </div>
            )}
            {contract.endDate && (
              <div>
                <p className="text-muted-foreground">End Date</p>
                <p className="font-medium">{format(contract.endDate, "MMM d, yyyy")}</p>
              </div>
            )}
            {contract.renewalDate && (
              <div>
                <p className="text-muted-foreground">Renewal Date</p>
                <p className="font-medium">{format(contract.renewalDate, "MMM d, yyyy")}</p>
              </div>
            )}
            {contract.noticePeriodDays && (
              <div>
                <p className="text-muted-foreground">Notice Period</p>
                <p className="font-medium">{contract.noticePeriodDays} days</p>
              </div>
            )}
            <div>
              <p className="text-muted-foreground">Auto-Renew</p>
              <p className="font-medium">{contract.autoRenew ? "Yes" : "No"}</p>
            </div>
          </div>
          {contract.summary && (
            <div className="mt-4 pt-4 border-t border-border">
              <p className="text-sm text-muted-foreground mb-1">Summary</p>
              <p className="text-sm whitespace-pre-wrap">{contract.summary}</p>
            </div>
          )}
          {contract.externalDocumentUrl && (
            <div className="mt-4 pt-4 border-t border-border">
              <p className="text-sm text-muted-foreground mb-1">
                Document Source {contract.documentSourceLabel && `(${contract.documentSourceLabel})`}
              </p>
              <a
                href={contract.externalDocumentUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-primary hover:underline"
              >
                {contract.externalDocumentUrl}
              </a>
            </div>
          )}
        </CardContent>
      </Card>
    ),
    "child-contracts": (contract.childContracts.length > 0 || perms.canCreate) ? (
      <Card className="h-full">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Child Contracts ({contract.childContracts.length})</CardTitle>
          {perms.canCreate && (
            <ContractCreateButton
              clients={clients}
              projects={projects}
              parentContracts={[]}
              defaultClientId={contract.client.id}
              defaultParentId={contract.id}
            />
          )}
        </CardHeader>
        <CardContent>
          <TreeView nodes={childNodes} />
        </CardContent>
      </Card>
    ) : (
      <Card className="h-full">
        <CardHeader><CardTitle>Child Contracts</CardTitle></CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">No child contracts</p>
        </CardContent>
      </Card>
    ),
    terms: (
      <Card className="h-full">
        <CardHeader>
          <CardTitle>Contract Terms ({contract.terms.length})</CardTitle>
        </CardHeader>
        <CardContent>
          <TermSection
            terms={contract.terms}
            contractId={contract.id}
            canEdit={perms.canEdit}
            canDelete={perms.canDelete}
          />
        </CardContent>
      </Card>
    ),
    comments: (
      <Card className="h-full">
        <CardHeader>
          <CardTitle>Comments</CardTitle>
        </CardHeader>
        <CardContent>
          <CommentSection
            comments={contract.comments}
            entityType="contract"
            entityId={contract.id}
            canComment={perms.canComment}
            canDelete={perms.canDelete}
            currentUserId={user.id}
          />
        </CardContent>
      </Card>
    ),
    attachments: (
      <Card className="h-full">
        <CardHeader>
          <CardTitle>Attachments</CardTitle>
        </CardHeader>
        <CardContent>
          <ContractAttachments
            contractId={contract.id}
            links={contract.links}
            embeds={contract.embeds}
            canEdit={perms.canEdit}
            canDelete={perms.canDelete}
          />
        </CardContent>
      </Card>
    ),
  };

  return (
    <div>
      <PageHeader
        title={contract.title}
        actions={
          <ContractActions
            contract={contract}
            clients={clients}
            projects={projects}
            allContracts={allContracts.filter((c) => c.id !== contract.id)}
            canEdit={perms.canEdit}
            canDelete={perms.canDelete}
          />
        }
      />

      {contract.parentContract && (
        <div className="mb-4 text-sm text-muted-foreground">
          <Link href={`/contracts/${contract.parentContract.id}`} className="hover:text-primary">
            {contract.parentContract.title}
          </Link>
          <span className="mx-2">→</span>
          <span className="text-foreground">{contract.title}</span>
        </div>
      )}

      <div className="flex items-center gap-3 mb-6 flex-wrap">
        <StatusBadge status={contract.status} />
        {contract.contractType && <Badge variant="outline">{contract.contractType}</Badge>}
        {contract.contractNumber && (
          <span className="text-sm text-muted-foreground">#{contract.contractNumber}</span>
        )}
        <Link href={`/clients/${contract.client.id}`} className="text-sm text-primary hover:underline">
          {contract.client.name}
        </Link>
        {contract.project && (
          <Link href={`/projects/${contract.project.id}`} className="text-sm text-primary hover:underline">
            {contract.project.name}
          </Link>
        )}
      </div>

      <PageLayout pageType="contract-detail" cards={cardMap} canEdit={canEditLayout} mode="flow" />
    </div>
  );
}
