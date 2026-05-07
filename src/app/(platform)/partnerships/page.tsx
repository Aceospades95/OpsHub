import { db } from "@/lib/db";
import { requireAuth, resolveModulePerms } from "@/lib/permissions";
import { AccessDenied } from "@/components/shared/access-denied";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { StatusBadge } from "@/components/shared/status-badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Badge } from "@/components/ui/badge";
import { Handshake, AlertTriangle, Mail } from "lucide-react";
import Link from "next/link";
import { PartnershipCreateButton } from "./partnership-create-button";
import { Prisma } from "@prisma/client";
import { pluralize } from "@/lib/pluralize";

interface Props {
  searchParams: { status?: string; type?: string; tier?: string };
}

const TIER_VARIANTS: Record<string, "outline" | "warning" | "success" | "secondary" | "default"> = {
  PLATINUM: "default",
  GOLD: "warning",
  SILVER: "secondary",
  BRONZE: "outline",
  STANDARD: "outline",
};

export default async function PartnershipsPage({ searchParams }: Props) {
  const user = await requireAuth();

  const perms = await resolveModulePerms(user.id, user.role, "partnerships");
  if (!perms.canView) {
    return (
      <AccessDenied
        module="partnerships"
        moduleLabel="Partnerships"
        moduleDescription="Strategic relationships — referrers, resellers, technology, channel, and joint-venture partners"
      />
    );
  }

  const where: Prisma.PartnershipWhereInput = { deletedAt: null };
  if (
    searchParams.status &&
    ["ACTIVE", "PROSPECT", "INACTIVE", "PAUSED", "ARCHIVED"].includes(searchParams.status)
  ) {
    where.status = searchParams.status as Prisma.PartnershipWhereInput["status"];
  }

  const partnerships = await db.partnership.findMany({
    where,
    orderBy: [{ status: "asc" }, { name: "asc" }],
    include: {
      _count: { select: { projects: true, contacts: true } },
    },
  });

  const now = new Date();

  return (
    <div>
      <PageHeader
        title="Partnerships"
        description="Strategic relationships and joint engagements"
        actions={perms.canCreate ? <PartnershipCreateButton /> : undefined}
      />

      {partnerships.length === 0 ? (
        <EmptyState
          icon={Handshake}
          title="No partnerships yet"
          description="Add your first partner to start tracking referrals and joint engagements"
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {partnerships.map((p) => {
            const agreementLapsing =
              p.agreementExpiresAt &&
              p.agreementExpiresAt > now &&
              p.agreementExpiresAt.getTime() - now.getTime() < 60 * 24 * 60 * 60 * 1000;
            const agreementExpired = p.agreementExpiresAt && p.agreementExpiresAt < now;
            return (
              <Link key={p.id} href={`/partnerships/${p.id}`}>
                <Card className="hover:shadow-md transition-shadow h-full">
                  <CardContent className="p-5">
                    <div className="flex items-start justify-between mb-2">
                      <h3 className="font-semibold text-foreground truncate">{p.name}</h3>
                      <StatusBadge status={p.status} />
                    </div>
                    <div className="flex flex-wrap items-center gap-2 mb-3">
                      <Badge variant="outline">{p.type.replace("_", " ").toLowerCase()}</Badge>
                      {p.tier && (
                        <Badge variant={TIER_VARIANTS[p.tier] || "outline"}>{p.tier}</Badge>
                      )}
                      {agreementExpired && (
                        <Badge variant="destructive" className="flex items-center gap-1">
                          <AlertTriangle className="h-3 w-3" /> Agreement expired
                        </Badge>
                      )}
                      {agreementLapsing && !agreementExpired && (
                        <Badge variant="warning" className="flex items-center gap-1">
                          <AlertTriangle className="h-3 w-3" /> Renewal due
                        </Badge>
                      )}
                    </div>
                    {p.description && (
                      <p className="text-sm text-muted-foreground line-clamp-2 mb-3">{p.description}</p>
                    )}
                    <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                      <span>{pluralize(p._count.projects, "project")}</span>
                      <span>{pluralize(p._count.contacts, "contact")}</span>
                      {p.primaryContactEmail && (
                        <span className="flex items-center gap-1">
                          <Mail className="h-3 w-3" />
                          {p.primaryContactEmail}
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
