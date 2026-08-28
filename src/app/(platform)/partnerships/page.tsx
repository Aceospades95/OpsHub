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
import { DownloadCsvButton } from "@/components/shared/download-csv-button";
import { Prisma } from "@prisma/client";
import { pluralize } from "@/lib/pluralize";
import { formatCalendarDate } from "@/lib/dates";
import { resolveViewPreference } from "@/lib/view-preference";
import { ViewOptionsBar } from "@/components/shared/view-options-bar";
import { GroupSection } from "@/components/shared/group-section";
import { groupRows } from "@/lib/group-rows";

const GROUP_OPTIONS = [
  { value: "type", label: "Type" },
  { value: "tier", label: "Tier" },
  { value: "status", label: "Status" },
] as const;
type GroupKey = (typeof GROUP_OPTIONS)[number]["value"];

function humanizeEnum(value: string): string {
  return value
    .split("_")
    .map((w) => w.charAt(0) + w.slice(1).toLowerCase())
    .join(" ");
}

interface Props {
  searchParams: { status?: string; type?: string; tier?: string; view?: string; groupBy?: string };
}

const TIER_VARIANTS: Record<string, "outline" | "warning" | "success" | "secondary" | "default"> = {
  PLATINUM: "default",
  GOLD: "warning",
  SILVER: "secondary",
  BRONZE: "outline",
  STANDARD: "outline",
};

export const metadata = { title: "Partnerships · OpsHub" };

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

  const view = resolveViewPreference(searchParams.view, "partnerships", ["table", "cards"], "table");
  const groupBy = GROUP_OPTIONS.some((o) => o.value === searchParams.groupBy)
    ? (searchParams.groupBy as GroupKey)
    : null;

  const partnerships = await db.partnership.findMany({
    where,
    orderBy: [{ status: "asc" }, { name: "asc" }],
    include: {
      _count: { select: { projects: true, contacts: true } },
    },
  });

  const now = new Date();

  type PartnershipRow = (typeof partnerships)[number];
  const groupKeyOf = (p: PartnershipRow, key: GroupKey): string | null => {
    switch (key) {
      case "type":
        return humanizeEnum(p.type);
      case "tier":
        return p.tier ? humanizeEnum(p.tier) : null;
      case "status":
        return humanizeEnum(p.status);
    }
  };

  // A column that is empty for every visible row costs width and shows
  // nothing — hide it until data exists.
  const showTier = partnerships.some((p) => p.tier);
  const showAgreementExpiry = partnerships.some((p) => p.agreementExpiresAt);
  const showProjects = partnerships.some((p) => p._count.projects > 0);

  const renderCards = (rows: PartnershipRow[]) => (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {rows.map((p) => {
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
  );

  const renderTable = (rows: PartnershipRow[]) => (
    <Card>
      <CardContent className="p-0 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted-foreground">
              <th className="p-3 font-medium">Name</th>
              <th className="p-3 font-medium">Type</th>
              {showTier && <th className="p-3 font-medium">Tier</th>}
              {showAgreementExpiry && <th className="p-3 font-medium">Agreement expires</th>}
              <th className="p-3 font-medium">Contact</th>
              {showProjects && <th className="p-3 font-medium text-right">Projects</th>}
              <th className="p-3 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => {
              const agreementExpired = p.agreementExpiresAt && p.agreementExpiresAt < now;
              const agreementLapsing =
                p.agreementExpiresAt &&
                p.agreementExpiresAt > now &&
                p.agreementExpiresAt.getTime() - now.getTime() < 60 * 24 * 60 * 60 * 1000;
              return (
                <tr key={p.id} className="border-b border-border last:border-0 hover:bg-muted/50">
                  <td className="p-3">
                    <Link href={`/partnerships/${p.id}`} className="font-medium hover:text-primary hover:underline">
                      {p.name}
                    </Link>
                  </td>
                  <td className="p-3 text-muted-foreground">{humanizeEnum(p.type)}</td>
                  {showTier && (
                    <td className="p-3">
                      {p.tier ? (
                        <Badge variant={TIER_VARIANTS[p.tier] || "outline"}>{p.tier}</Badge>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                  )}
                  {showAgreementExpiry && (
                    <td
                      className={`p-3 ${
                        agreementExpired
                          ? "text-destructive font-medium"
                          : agreementLapsing
                            ? "text-warning font-medium"
                            : "text-muted-foreground"
                      }`}
                    >
                      {p.agreementExpiresAt ? formatCalendarDate(p.agreementExpiresAt, "MMM d, yyyy") : "—"}
                    </td>
                  )}
                  <td className="p-3 text-muted-foreground">
                    {p.primaryContactName || p.primaryContactEmail || "—"}
                  </td>
                  {showProjects && (
                    <td className="p-3 text-right tabular-nums">{p._count.projects}</td>
                  )}
                  <td className="p-3"><StatusBadge status={p.status} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );

  const renderRows = view === "table" ? renderTable : renderCards;
  const groups = groupBy ? groupRows(partnerships, (p) => groupKeyOf(p, groupBy)) : null;

  return (
    <div>
      <PageHeader
        title="Partnerships"
        description="Strategic relationships and joint engagements"
        actions={
          <div className="flex items-center gap-2">
            {user.role === "ADMIN" && <DownloadCsvButton importerKey="partnerships" />}
            {perms.canCreate && <PartnershipCreateButton />}
          </div>
        }
      />

      <ViewOptionsBar
        view={view}
        viewOptions={[
          { value: "table", label: "Table" },
          { value: "cards", label: "Cards" },
        ]}
        storageKey="partnerships"
        groupBy={groupBy}
        groupByOptions={[...GROUP_OPTIONS]}
      />

      {partnerships.length === 0 ? (
        <EmptyState
          icon={Handshake}
          title="No partnerships yet"
          description="Add your first partner to start tracking referrals and joint engagements"
        />
      ) : groups ? (
        groups.map((group) => (
          <GroupSection key={group.label} label={group.label} count={group.rows.length}>
            {renderRows(group.rows)}
          </GroupSection>
        ))
      ) : (
        renderRows(partnerships)
      )}
    </div>
  );
}
