import { db } from "@/lib/db";
import { requireAuth, resolveModulePerms } from "@/lib/permissions";
import { AccessDenied } from "@/components/shared/access-denied";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { StatusBadge } from "@/components/shared/status-badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Badge } from "@/components/ui/badge";
import { HardHat, Star, Mail, Phone, AlertTriangle } from "lucide-react";
import Link from "next/link";
import { SubcontractorCreateButton } from "./subcontractor-create-button";
import { Prisma } from "@prisma/client";
import { pluralize } from "@/lib/pluralize";

interface Props {
  searchParams: { status?: string; type?: string; compliance?: string };
}

export default async function SubcontractorsPage({ searchParams }: Props) {
  const user = await requireAuth();

  const perms = await resolveModulePerms(user.id, user.role, "subcontractors");
  if (!perms.canView) {
    return (
      <AccessDenied
        module="subcontractors"
        moduleLabel="Subcontractors"
        moduleDescription="External project labor — 1099 contractors, sub firms, and staffing agencies"
      />
    );
  }

  const where: Prisma.SubcontractorWhereInput = { deletedAt: null };
  if (searchParams.status && ["ACTIVE", "INACTIVE", "ONBOARDING", "SUSPENDED", "ARCHIVED"].includes(searchParams.status)) {
    where.status = searchParams.status as Prisma.SubcontractorWhereInput["status"];
  }
  if (searchParams.type && ["INDIVIDUAL", "COMPANY", "AGENCY"].includes(searchParams.type)) {
    where.type = searchParams.type as Prisma.SubcontractorWhereInput["type"];
  }
  if (searchParams.compliance && ["COMPLIANT", "PENDING", "EXPIRED", "NON_COMPLIANT"].includes(searchParams.compliance)) {
    where.complianceStatus = searchParams.compliance as Prisma.SubcontractorWhereInput["complianceStatus"];
  }

  const subcontractors = await db.subcontractor.findMany({
    where,
    orderBy: [{ isPreferred: "desc" }, { name: "asc" }],
    include: {
      _count: { select: { projects: { where: { status: { in: ["ACTIVE", "PLANNED"] } } } } },
    },
  });

  const now = new Date();
  const expiringSoon = (date: Date | null): boolean => {
    if (!date) return false;
    const ms = date.getTime() - now.getTime();
    return ms > 0 && ms < 30 * 24 * 60 * 60 * 1000;
  };

  return (
    <div>
      <PageHeader
        title="Subcontractors"
        description="External project labor"
        actions={perms.canCreate ? <SubcontractorCreateButton /> : undefined}
      />

      {subcontractors.length === 0 ? (
        <EmptyState
          icon={HardHat}
          title="No subcontractors yet"
          description="Add your first subcontractor to start tracking project labor"
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {subcontractors.map((sub) => {
            const insuranceFlag = expiringSoon(sub.insuranceExpiresAt) || (sub.insuranceExpiresAt && sub.insuranceExpiresAt < now);
            return (
              <Link key={sub.id} href={`/subcontractors/${sub.id}`}>
                <Card className="hover:shadow-md transition-shadow h-full">
                  <CardContent className="p-5">
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <h3 className="font-semibold text-foreground truncate">{sub.name}</h3>
                        {sub.isPreferred && (
                          <Star className="h-4 w-4 text-warning fill-warning shrink-0" />
                        )}
                      </div>
                      <StatusBadge status={sub.status} />
                    </div>
                    <div className="flex flex-wrap items-center gap-2 mb-3">
                      <Badge variant="outline">{sub.type}</Badge>
                      {sub.complianceStatus !== "COMPLIANT" && (
                        <Badge variant={sub.complianceStatus === "NON_COMPLIANT" || sub.complianceStatus === "EXPIRED" ? "destructive" : "warning"}>
                          {sub.complianceStatus.replace("_", " ").toLowerCase()}
                        </Badge>
                      )}
                      {insuranceFlag && (
                        <Badge variant="warning" className="flex items-center gap-1">
                          <AlertTriangle className="h-3 w-3" /> Insurance
                        </Badge>
                      )}
                    </div>
                    <div className="space-y-1 text-xs text-muted-foreground">
                      {sub.primaryContactName && <p>{sub.primaryContactName}</p>}
                      {sub.primaryContactEmail && (
                        <p className="flex items-center gap-1">
                          <Mail className="h-3 w-3" /> {sub.primaryContactEmail}
                        </p>
                      )}
                      {sub.primaryContactPhone && (
                        <p className="flex items-center gap-1">
                          <Phone className="h-3 w-3" /> {sub.primaryContactPhone}
                        </p>
                      )}
                      <p className="pt-1">{pluralize(sub._count.projects, "active project")}</p>
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
