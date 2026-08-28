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
import { DownloadCsvButton } from "@/components/shared/download-csv-button";
import { Prisma } from "@prisma/client";
import { pluralize } from "@/lib/pluralize";
import { formatCalendarDate } from "@/lib/dates";
import { resolveViewPreference } from "@/lib/view-preference";
import { ViewOptionsBar } from "@/components/shared/view-options-bar";
import { GroupSection } from "@/components/shared/group-section";
import { groupRows } from "@/lib/group-rows";

const GROUP_OPTIONS = [
  { value: "status", label: "Status" },
  { value: "type", label: "Type" },
  { value: "compliance", label: "Compliance" },
] as const;
type GroupKey = (typeof GROUP_OPTIONS)[number]["value"];

function humanizeEnum(value: string): string {
  return value
    .split("_")
    .map((w) => w.charAt(0) + w.slice(1).toLowerCase())
    .join(" ");
}

interface Props {
  searchParams: { status?: string; type?: string; compliance?: string; view?: string; groupBy?: string };
}

export const metadata = { title: "Subcontractors · OpsHub" };

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

  const view = resolveViewPreference(searchParams.view, "subcontractors", ["table", "cards"], "table");
  const groupBy = GROUP_OPTIONS.some((o) => o.value === searchParams.groupBy)
    ? (searchParams.groupBy as GroupKey)
    : null;

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

  type SubRow = (typeof subcontractors)[number];
  const groupKeyOf = (sub: SubRow, key: GroupKey): string | null => {
    switch (key) {
      case "status":
        return humanizeEnum(sub.status);
      case "type":
        return humanizeEnum(sub.type);
      case "compliance":
        return humanizeEnum(sub.complianceStatus);
    }
  };

  // A column that is empty for every visible row costs width and shows
  // nothing — hide it until data exists.
  const showInsurance = subcontractors.some((s) => s.insuranceExpiresAt);
  const showActiveProjects = subcontractors.some((s) => s._count.projects > 0);

  const renderCards = (rows: SubRow[]) => (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {rows.map((sub) => {
        const insuranceFlag = expiringSoon(sub.insuranceExpiresAt) || (sub.insuranceExpiresAt && sub.insuranceExpiresAt < now);
        return (
          <Link key={sub.id} href={`/subcontractors/${sub.id}`}>
            <Card className="hover:shadow-md transition-shadow h-full">
              <CardContent className="p-5">
                <div className="flex items-start justify-between mb-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <h3 className="font-semibold text-foreground truncate">{sub.name}</h3>
                    {sub.isPreferred && (
                      <span className="inline-flex shrink-0" title="Preferred subcontractor">
                        <Star
                          className="h-4 w-4 text-warning fill-warning"
                          role="img"
                          aria-label="Preferred subcontractor"
                        />
                      </span>
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
  );

  const renderTable = (rows: SubRow[]) => (
    <Card>
      <CardContent className="p-0 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted-foreground">
              <th className="p-3 font-medium">Name</th>
              <th className="p-3 font-medium">Type</th>
              <th className="p-3 font-medium">Compliance</th>
              {showInsurance && <th className="p-3 font-medium">Insurance expires</th>}
              <th className="p-3 font-medium">Contact</th>
              {showActiveProjects && <th className="p-3 font-medium text-right">Active projects</th>}
              <th className="p-3 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((sub) => {
              const insuranceFlag = expiringSoon(sub.insuranceExpiresAt) || (sub.insuranceExpiresAt && sub.insuranceExpiresAt < now);
              return (
                <tr key={sub.id} className="border-b border-border last:border-0 hover:bg-muted/50">
                  <td className="p-3">
                    <Link
                      href={`/subcontractors/${sub.id}`}
                      className="font-medium hover:text-primary hover:underline inline-flex items-center gap-1.5"
                    >
                      {sub.name}
                      {sub.isPreferred && (
                        // The tooltip's title attribute lives on a span — a
                        // title attribute on a bare <svg> doesn't render one.
                        <span className="inline-flex" title="Preferred subcontractor">
                          <Star
                            className="h-3.5 w-3.5 text-warning fill-warning"
                            role="img"
                            aria-label="Preferred subcontractor"
                          />
                        </span>
                      )}
                    </Link>
                  </td>
                  <td className="p-3 text-muted-foreground">{humanizeEnum(sub.type)}</td>
                  <td className="p-3">
                    <Badge
                      variant={
                        sub.complianceStatus === "COMPLIANT"
                          ? "success"
                          : sub.complianceStatus === "PENDING"
                            ? "warning"
                            : "destructive"
                      }
                    >
                      {humanizeEnum(sub.complianceStatus)}
                    </Badge>
                  </td>
                  {showInsurance && (
                    <td className={`p-3 ${insuranceFlag ? "text-warning font-medium" : "text-muted-foreground"}`}>
                      {sub.insuranceExpiresAt
                        ? formatCalendarDate(sub.insuranceExpiresAt, "MMM d, yyyy")
                        : "—"}
                    </td>
                  )}
                  <td className="p-3 text-muted-foreground">
                    {sub.primaryContactName || sub.primaryContactEmail || "—"}
                  </td>
                  {showActiveProjects && (
                    <td className="p-3 text-right tabular-nums">{sub._count.projects}</td>
                  )}
                  <td className="p-3"><StatusBadge status={sub.status} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );

  const renderRows = view === "table" ? renderTable : renderCards;

  return (
    <div>
      <PageHeader
        title="Subcontractors"
        description="External project labor"
        actions={
          <div className="flex items-center gap-2">
            {user.role === "ADMIN" && <DownloadCsvButton importerKey="subcontractors" />}
            {perms.canCreate && <SubcontractorCreateButton />}
          </div>
        }
      />

      <ViewOptionsBar
        view={view}
        viewOptions={[
          { value: "table", label: "Table" },
          { value: "cards", label: "Cards" },
        ]}
        storageKey="subcontractors"
        groupBy={groupBy}
        groupByOptions={[...GROUP_OPTIONS]}
      />

      {subcontractors.length === 0 ? (
        <EmptyState
          icon={HardHat}
          title="No subcontractors yet"
          description="Add your first subcontractor to start tracking project labor"
        />
      ) : groupBy ? (
        groupRows(subcontractors, (sub) => groupKeyOf(sub, groupBy)).map((group) => (
          <GroupSection key={group.label} label={group.label} count={group.rows.length}>
            {renderRows(group.rows)}
          </GroupSection>
        ))
      ) : (
        renderRows(subcontractors)
      )}
    </div>
  );
}
