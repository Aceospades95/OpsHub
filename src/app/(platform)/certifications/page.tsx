import { db } from "@/lib/db";
import { requireAuth, resolveModulePerms } from "@/lib/permissions";
import { getUserScope } from "@/lib/scope";
import { AccessDenied } from "@/components/shared/access-denied";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/shared/status-badge";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import {
  Award,
  AlertTriangle,
  Clock,
  CheckCircle2,
  XCircle,
  RotateCcw,
  MapPin,
  Hourglass,
} from "lucide-react";
import { differenceInDays } from "date-fns";
import { formatCalendarDate } from "@/lib/dates";
import Link from "next/link";
import type { JurisdictionLevel, CertEngagementType, Prisma } from "@prisma/client";
import { CertCreateButton } from "./cert-create-button";
import { CertFilters } from "./cert-filters";
import { DownloadCsvButton } from "@/components/shared/download-csv-button";
import { ViewOptionsBar } from "@/components/shared/view-options-bar";
import { GroupSection } from "@/components/shared/group-section";
import { groupRows } from "@/lib/group-rows";
import { certBucket, CERT_BUCKETS, CERT_BUCKET_LABELS, type CertBucket } from "@/lib/effective-status";

const JURISDICTION_LEVELS: JurisdictionLevel[] = [
  "FEDERAL",
  "STATE",
  "COUNTY",
  "CITY",
  "AGENCY",
  "PRIVATE",
  "OTHER",
];

const ENGAGEMENT_TYPES: CertEngagementType[] = ["CERTIFICATION", "SUBSCRIPTION"];

/** StatusBadge-compatible value per effective bucket. */
const BUCKET_TO_STATUS: Record<CertBucket, string> = {
  active: "ACTIVE",
  expiring: "EXPIRING_SOON",
  expired: "EXPIRED",
  pending: "PENDING",
  renewing: "RENEWAL_SUBMITTED",
};

type CertRow = Prisma.CertificationGetPayload<{
  include: {
    client: { select: { id: true; name: true } };
    assignee: { select: { id: true; name: true } };
    pointOfContact: { select: { id: true; name: true } };
  };
}>;

const GROUP_OPTIONS = [
  { value: "state", label: "State / jurisdiction name" },
  { value: "level", label: "Jurisdiction level" },
  { value: "status", label: "Status" },
  { value: "type", label: "Type" },
  { value: "engagement", label: "Engagement" },
  { value: "client", label: "Client" },
  { value: "assignee", label: "Assignee" },
] as const;
type GroupKey = (typeof GROUP_OPTIONS)[number]["value"];

function humanizeEnum(value: string): string {
  return value
    .split("_")
    .map((w) => w.charAt(0) + w.slice(1).toLowerCase())
    .join(" ");
}

interface PageProps {
  searchParams: Promise<{
    jurisdiction?: string;
    engagement?: string;
    status?: string;
    view?: string;
    groupBy?: string;
  }>;
}

export const metadata = { title: "Certifications · OpsHub" };

export default async function CertificationsPage({ searchParams }: PageProps) {
  const user = await requireAuth();

  // Module canView, like sibling modules. Assignees / points of contact
  // get canView through their cert scope (resolveModulePerms grants it
  // when scope.certIds is non-empty) so expiry-notification links work;
  // the scope filter below restricts the list to those certs. Writes stay
  // role-gated via canCreate further down.
  const perms = await resolveModulePerms(user.id, user.role, "certifications");
  if (!perms.canView) {
    return <AccessDenied module="certifications" moduleLabel="Certifications" moduleDescription="Compliance certifications and expirations" />;
  }

  const sp = await searchParams;
  const jurisdictionFilter = JURISDICTION_LEVELS.includes(sp.jurisdiction as JurisdictionLevel)
    ? (sp.jurisdiction as JurisdictionLevel)
    : null;
  const engagementFilter = ENGAGEMENT_TYPES.includes(sp.engagement as CertEngagementType)
    ? (sp.engagement as CertEngagementType)
    : null;
  const statusFilter = CERT_BUCKETS.includes(sp.status as CertBucket)
    ? (sp.status as CertBucket)
    : null;
  const view = sp.view === "table" ? "table" : "cards";
  const groupBy = GROUP_OPTIONS.some((o) => o.value === sp.groupBy)
    ? (sp.groupBy as GroupKey)
    : null;

  const scope = await getUserScope(user.id, user.role);
  const scopedCertIds = scope.all ? null : Array.from(scope.certIds);
  const scopedClientIds = scope.all ? null : Array.from(scope.clientIds);

  const canCreate =
    user.role === "ADMIN" ||
    user.role === "MANAGER" ||
    user.role === "DEVELOPER";

  const [certifications, clients, users] = await Promise.all([
    db.certification.findMany({
      where: {
        deletedAt: null,
        ...(jurisdictionFilter ? { jurisdictionLevel: jurisdictionFilter } : {}),
        ...(engagementFilter ? { engagementType: engagementFilter } : {}),
        ...(scopedCertIds ? { id: { in: scopedCertIds } } : {}),
      },
      orderBy: [{ expirationDate: "asc" }],
      include: {
        client: { select: { id: true, name: true } },
        assignee: { select: { id: true, name: true } },
        pointOfContact: { select: { id: true, name: true } },
      },
    }),
    // Create-dialog dropdowns — only needed by users who can create.
    canCreate
      ? db.client.findMany({
          where: { deletedAt: null, ...(scopedClientIds ? { id: { in: scopedClientIds } } : {}) },
          select: { id: true, name: true },
          orderBy: { name: "asc" },
        })
      : Promise.resolve([]),
    canCreate
      ? db.user.findMany({
          where: { isActive: true },
          select: { id: true, name: true },
          orderBy: { name: "asc" },
        })
      : Promise.resolve([]),
  ]);

  const now = new Date();

  // Compute breakdown buckets from the full (scope+jurisdiction+engagement)
  // result set so stat counts reflect what the user would see once the
  // status filter is cleared. Filtering is applied to the visible list below.
  // Bucketing is date-derived via lib/effective-status — the stored
  // EXPIRING_SOON/EXPIRED enum values are never trusted for display.
  const buckets: Record<CertBucket, CertRow[]> = {
    active: [],
    expiring: [],
    expired: [],
    pending: [],
    renewing: [],
  };
  for (const cert of certifications) buckets[certBucket(cert, now)].push(cert);
  const expiringSoon = buckets.expiring;
  const visibleCerts = statusFilter ? buckets[statusFilter] : certifications;

  /** Manual statuses pass through; everything else shows the date-derived bucket. */
  const displayStatus = (cert: CertRow): string =>
    cert.status === "SUSPENDED" || cert.status === "REVOKED"
      ? cert.status
      : BUCKET_TO_STATUS[certBucket(cert, now)];

  const groupKeyOf = (cert: CertRow, key: GroupKey): string | null => {
    switch (key) {
      case "state":
        return cert.jurisdictionName;
      case "level":
        return humanizeEnum(cert.jurisdictionLevel);
      case "status":
        return CERT_BUCKET_LABELS[certBucket(cert, now)];
      case "type":
        return humanizeEnum(cert.type);
      case "engagement":
        return humanizeEnum(cert.engagementType);
      case "client":
        return cert.client?.name ?? null;
      case "assignee":
        return cert.assignee?.name ?? null;
    }
  };

  const buildHref = (overrides: {
    jurisdiction?: string | null;
    engagement?: string | null;
    status?: string | null;
  }) => {
    const params = new URLSearchParams();
    const nextJuris = overrides.jurisdiction === undefined ? jurisdictionFilter : overrides.jurisdiction;
    const nextEng = overrides.engagement === undefined ? engagementFilter : overrides.engagement;
    const nextStatus = overrides.status === undefined ? statusFilter : overrides.status;
    if (nextJuris) params.set("jurisdiction", nextJuris);
    if (nextEng) params.set("engagement", nextEng);
    if (nextStatus) params.set("status", nextStatus);
    if (view !== "cards") params.set("view", view);
    if (groupBy) params.set("groupBy", groupBy);
    const qs = params.toString();
    return qs ? `/certifications?${qs}` : "/certifications";
  };

  const hasAnyFilter =
    jurisdictionFilter !== null || engagementFilter !== null || statusFilter !== null;

  const renderCards = (rows: CertRow[]) => (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {rows.map((cert) => {
        const daysUntilExpiry = cert.expirationDate
          ? differenceInDays(cert.expirationDate, now)
          : null;
        const isExpiring =
          daysUntilExpiry !== null &&
          daysUntilExpiry > 0 &&
          daysUntilExpiry <= (cert.renewalLeadDays || 90);
        const isExpired = daysUntilExpiry !== null && daysUntilExpiry <= 0;
        const jurisdictionLabel = [cert.jurisdictionLevel, cert.jurisdictionName]
          .filter(Boolean)
          .join(" · ");

        return (
          <Link key={cert.id} href={`/certifications/${cert.id}`}>
            <Card
              className={`hover:shadow-md transition-shadow h-full ${
                isExpired ? "border-destructive/50" : isExpiring ? "border-warning/50" : ""
              }`}
            >
              <CardContent className="p-5">
                <div className="flex items-start justify-between mb-2">
                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold text-foreground text-sm truncate">
                      {cert.name}
                    </h3>
                    {cert.issuingBody && (
                      <p className="text-xs text-muted-foreground">{cert.issuingBody}</p>
                    )}
                  </div>
                  <StatusBadge status={displayStatus(cert)} />
                </div>

                {cert.client && (
                  <p className="text-sm text-muted-foreground">{cert.client.name}</p>
                )}

                <div className="flex items-center gap-2 mt-3 flex-wrap">
                  <Badge variant="outline">{cert.type.replace(/_/g, " ")}</Badge>
                  <Badge variant="secondary" className="gap-1">
                    <MapPin className="h-3 w-3" />
                    {jurisdictionLabel || cert.jurisdictionLevel}
                  </Badge>
                  {cert.engagementType === "SUBSCRIPTION" && (
                    <Badge variant="outline">Subscription</Badge>
                  )}
                  {cert.certNumber && (
                    <span className="text-xs text-muted-foreground">#{cert.certNumber}</span>
                  )}
                  {cert.autoRenew && <Badge variant="secondary">Auto-renew</Badge>}
                  {/* Round-6 QA: a "Pending" status alongside a
                   *  green "Signed off" badge read as a
                   *  contradiction. The signoff fields capture
                   *  internal review approval — the cert isn't
                   *  actually issued / Active until status
                   *  transitions there too. Suppress the badge
                   *  on Pending; on Active it still confirms
                   *  approval; on other statuses (Expired,
                   *  Revoked) the signoff history is still
                   *  visible on the detail page's audit trail. */}
                  {cert.signedOffAt && cert.status !== "PENDING" && (
                    <Badge variant="success" className="gap-1">
                      <CheckCircle2 className="h-3 w-3" />
                      Signed off
                    </Badge>
                  )}
                </div>

                <div className="flex items-center gap-3 mt-3 pt-3 border-t border-border text-xs">
                  {isExpired && (
                    <span className="flex items-center gap-1 text-destructive font-medium">
                      <AlertTriangle className="h-3 w-3" /> Expired
                      {cert.expirationDate &&
                        ` ${formatCalendarDate(cert.expirationDate, "MMM d, yyyy")}`}
                    </span>
                  )}
                  {isExpiring && (
                    <span className="flex items-center gap-1 text-warning font-medium">
                      <Clock className="h-3 w-3" /> {daysUntilExpiry}d until expiry
                    </span>
                  )}
                  {!isExpired && !isExpiring && cert.expirationDate && (
                    <span className="text-muted-foreground">
                      Expires {formatCalendarDate(cert.expirationDate, "MMM d, yyyy")}
                    </span>
                  )}
                  {!cert.expirationDate && (
                    <span className="text-muted-foreground">No expiration date</span>
                  )}
                  {cert.assignee && (
                    <span className="text-muted-foreground ml-auto">
                      {cert.assignee.name}
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

  const renderTable = (rows: CertRow[]) => (
    <Card>
      <CardContent className="p-0 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted-foreground">
              <th className="p-3 font-medium">Name</th>
              <th className="p-3 font-medium">Type</th>
              <th className="p-3 font-medium">Jurisdiction</th>
              <th className="p-3 font-medium">Client</th>
              <th className="p-3 font-medium">Assignee</th>
              <th className="p-3 font-medium">Expires</th>
              <th className="p-3 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((cert) => {
              const daysUntilExpiry = cert.expirationDate
                ? differenceInDays(cert.expirationDate, now)
                : null;
              const isExpired = daysUntilExpiry !== null && daysUntilExpiry <= 0;
              const isExpiring =
                daysUntilExpiry !== null &&
                daysUntilExpiry > 0 &&
                daysUntilExpiry <= (cert.renewalLeadDays || 90);
              return (
                <tr key={cert.id} className="border-b border-border last:border-0 hover:bg-muted/50">
                  <td className="p-3">
                    <Link
                      href={`/certifications/${cert.id}`}
                      className="font-medium hover:text-primary hover:underline"
                    >
                      {cert.name}
                    </Link>
                    <div className="text-xs text-muted-foreground">
                      {[cert.issuingBody, cert.certNumber ? `#${cert.certNumber}` : null]
                        .filter(Boolean)
                        .join(" · ")}
                    </div>
                  </td>
                  <td className="p-3 text-muted-foreground">{humanizeEnum(cert.type)}</td>
                  <td className="p-3 text-muted-foreground">
                    {[humanizeEnum(cert.jurisdictionLevel), cert.jurisdictionName]
                      .filter(Boolean)
                      .join(" · ")}
                  </td>
                  <td className="p-3 text-muted-foreground">
                    {cert.client ? (
                      <Link href={`/clients/${cert.client.id}`} className="hover:text-primary hover:underline">
                        {cert.client.name}
                      </Link>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="p-3 text-muted-foreground">
                    {cert.assignee ? (
                      <Link href={`/team/${cert.assignee.id}`} className="hover:text-primary hover:underline">
                        {cert.assignee.name}
                      </Link>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="p-3">
                    {cert.expirationDate ? (
                      <span
                        className={
                          isExpired
                            ? "text-destructive font-medium"
                            : isExpiring
                              ? "text-warning font-medium"
                              : "text-muted-foreground"
                        }
                      >
                        {formatCalendarDate(cert.expirationDate, "MMM d, yyyy")}
                        {isExpiring && ` (${daysUntilExpiry}d)`}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="p-3">
                    <StatusBadge status={displayStatus(cert)} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );

  const renderRows = view === "table" ? renderTable : renderCards;
  const groups = groupBy
    ? groupRows(visibleCerts, (cert) => groupKeyOf(cert, groupBy))
    : null;

  return (
    <div>
      <PageHeader
        title="Certifications"
        description="Track certifications, renewals, and compliance"
        actions={
          <div className="flex items-center gap-2">
            {user.role === "ADMIN" && <DownloadCsvButton importerKey="certifications" />}
            {canCreate && <CertCreateButton clients={clients} users={users} />}
          </div>
        }
      />

      {/* Clickable status buckets — tap a card to filter the list below. */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-5 mb-6">
        {(
          [
            {
              key: "active" as const,
              label: "Active",
              count: buckets.active.length,
              Icon: CheckCircle2,
              iconWrap: "bg-success/10",
              iconColor: "text-success",
              activeBorder: "",
            },
            {
              key: "expiring" as const,
              label: "Expiring Soon",
              count: buckets.expiring.length,
              Icon: Clock,
              iconWrap: "bg-warning/15",
              iconColor: "text-warning",
              activeBorder: buckets.expiring.length > 0 ? "border-warning/50" : "",
            },
            {
              key: "expired" as const,
              label: "Expired",
              count: buckets.expired.length,
              Icon: XCircle,
              iconWrap: "bg-destructive/10",
              iconColor: "text-destructive",
              activeBorder: buckets.expired.length > 0 ? "border-destructive/50" : "",
            },
            {
              key: "renewing" as const,
              label: "Renewal Submitted",
              count: buckets.renewing.length,
              Icon: Hourglass,
              iconWrap: "bg-primary/10",
              iconColor: "text-primary",
              activeBorder: "",
            },
            {
              key: "pending" as const,
              label: "Pending",
              count: buckets.pending.length,
              Icon: RotateCcw,
              iconWrap: "bg-blue-500/10",
              iconColor: "text-blue-600",
              activeBorder: "",
            },
          ] as const
        ).map((stat) => {
          const isActive = statusFilter === stat.key;
          return (
            <Link
              key={stat.key}
              href={buildHref({ status: isActive ? null : stat.key })}
              aria-pressed={isActive}
            >
              <Card
                className={`transition-shadow hover:shadow-md ${
                  isActive ? "border-primary ring-1 ring-primary/40" : stat.activeBorder
                }`}
              >
                <CardContent className="p-4 flex items-center gap-3">
                  <div className={`p-2 rounded-lg ${stat.iconWrap}`}>
                    <stat.Icon className={`h-5 w-5 ${stat.iconColor}`} />
                  </div>
                  <div>
                    <p className="text-2xl font-bold">{stat.count}</p>
                    <p className="text-xs text-muted-foreground">{stat.label}</p>
                  </div>
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </div>

      <CertFilters
        jurisdictionLevels={JURISDICTION_LEVELS}
        engagementTypes={ENGAGEMENT_TYPES}
        jurisdictionFilter={jurisdictionFilter}
        engagementFilter={engagementFilter}
        hasAnyFilter={hasAnyFilter}
      />

      <ViewOptionsBar
        view={view}
        viewOptions={[
          { value: "cards", label: "Cards" },
          { value: "table", label: "Table" },
        ]}
        groupBy={groupBy}
        groupByOptions={[...GROUP_OPTIONS]}
      />

      {/* Renewal alerts */}
      {expiringSoon.length > 0 && (
        <Card className="mb-6 border-warning/30">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2 text-warning">
              <AlertTriangle className="h-4 w-4" />
              Upcoming Renewals ({expiringSoon.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {expiringSoon.map((cert) => {
                const daysLeft = cert.expirationDate ? differenceInDays(cert.expirationDate, now) : 0;
                return (
                  <Link
                    key={cert.id}
                    href={`/certifications/${cert.id}`}
                    className="flex items-center gap-3 py-2 px-3 rounded-md hover:bg-muted transition-colors"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium">{cert.name}</p>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        {cert.issuingBody && <span>{cert.issuingBody}</span>}
                        {cert.client && <span>· {cert.client.name}</span>}
                        {cert.assignee && <span>· {cert.assignee.name}</span>}
                      </div>
                    </div>
                    <span
                      className={`text-xs font-semibold ${
                        daysLeft <= 30 ? "text-destructive" : "text-warning"
                      }`}
                    >
                      {daysLeft}d left
                    </span>
                    {cert.renewalRequirements && (
                      <Badge variant="outline" className="text-[10px]">
                        Renewal info
                      </Badge>
                    )}
                  </Link>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* All certifications */}
      {visibleCerts.length === 0 ? (
        <EmptyState
          icon={Award}
          title="No certifications yet"
          description={
            hasAnyFilter
              ? "No certifications match the current filters."
              : "Add your first certification to start tracking renewals"
          }
        />
      ) : groups ? (
        groups.map((group) => (
          <GroupSection key={group.label} label={group.label} count={group.rows.length}>
            {renderRows(group.rows)}
          </GroupSection>
        ))
      ) : (
        renderRows(visibleCerts)
      )}
    </div>
  );
}
