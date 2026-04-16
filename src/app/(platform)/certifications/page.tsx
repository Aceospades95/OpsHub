import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { resolveModulePerms } from "@/lib/permissions";
import { getUserScope } from "@/lib/scope";
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
} from "lucide-react";
import { format, differenceInDays } from "date-fns";
import Link from "next/link";
import type { JurisdictionLevel, CertEngagementType } from "@prisma/client";
import { CertCreateButton } from "./cert-create-button";

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

type StatusBucket = "active" | "expiring" | "expired" | "pending";
const STATUS_BUCKETS: StatusBucket[] = ["active", "expiring", "expired", "pending"];

interface PageProps {
  searchParams: Promise<{
    jurisdiction?: string;
    engagement?: string;
    status?: string;
  }>;
}

export default async function CertificationsPage({ searchParams }: PageProps) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const sp = await searchParams;
  const jurisdictionFilter = JURISDICTION_LEVELS.includes(sp.jurisdiction as JurisdictionLevel)
    ? (sp.jurisdiction as JurisdictionLevel)
    : null;
  const engagementFilter = ENGAGEMENT_TYPES.includes(sp.engagement as CertEngagementType)
    ? (sp.engagement as CertEngagementType)
    : null;
  const statusFilter = STATUS_BUCKETS.includes(sp.status as StatusBucket)
    ? (sp.status as StatusBucket)
    : null;

  const _perms = await resolveModulePerms(session.user.id, session.user.role, "certifications");

  const scope = await getUserScope(session.user.id, session.user.role);
  const scopedCertIds = scope.all ? null : Array.from(scope.certIds);
  const scopedClientIds = scope.all ? null : Array.from(scope.clientIds);

  const [certifications, clients, users] = await Promise.all([
    db.certification.findMany({
      where: {
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
    db.client.findMany({
      where: scopedClientIds ? { id: { in: scopedClientIds } } : {},
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    db.user.findMany({
      where: { isActive: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);

  const now = new Date();

  // Compute breakdown buckets from the full (scope+jurisdiction+engagement)
  // result set so stat counts reflect what the user would see once the
  // status filter is cleared. Filtering is applied to the visible list below.
  const bucketOf = (c: (typeof certifications)[number]): StatusBucket => {
    if (c.status === "PENDING") return "pending";
    if (c.expirationDate) {
      const days = differenceInDays(c.expirationDate, now);
      if (days <= 0) return "expired";
      if (days <= (c.renewalLeadDays || 90)) return "expiring";
    } else if (c.status === "EXPIRED") {
      return "expired";
    }
    return "active";
  };
  const buckets: Record<StatusBucket, typeof certifications> = {
    active: [],
    expiring: [],
    expired: [],
    pending: [],
  };
  for (const cert of certifications) buckets[bucketOf(cert)].push(cert);
  const active = buckets.active;
  const expiringSoon = buckets.expiring;
  const expired = buckets.expired;
  const pending = buckets.pending;
  const visibleCerts = statusFilter ? buckets[statusFilter] : certifications;

  const canCreate =
    session.user.role === "ADMIN" ||
    session.user.role === "MANAGER" ||
    session.user.role === "DEVELOPER";

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
    const qs = params.toString();
    return qs ? `/certifications?${qs}` : "/certifications";
  };

  const hasAnyFilter =
    jurisdictionFilter !== null || engagementFilter !== null || statusFilter !== null;

  return (
    <div>
      <PageHeader
        title="Certifications"
        description="Track certifications, renewals, and compliance"
        actions={canCreate ? <CertCreateButton clients={clients} users={users} /> : undefined}
      />

      {/* Clickable status buckets — tap a card to filter the list below. */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 mb-6">
        {(
          [
            {
              key: "active" as const,
              label: "Active",
              count: active.length,
              Icon: CheckCircle2,
              iconWrap: "bg-green-50",
              iconColor: "text-green-600",
              activeBorder: "",
            },
            {
              key: "expiring" as const,
              label: "Expiring Soon",
              count: expiringSoon.length,
              Icon: Clock,
              iconWrap: "bg-yellow-50",
              iconColor: "text-yellow-600",
              activeBorder: expiringSoon.length > 0 ? "border-warning/50" : "",
            },
            {
              key: "expired" as const,
              label: "Expired",
              count: expired.length,
              Icon: XCircle,
              iconWrap: "bg-red-50",
              iconColor: "text-red-600",
              activeBorder: expired.length > 0 ? "border-destructive/50" : "",
            },
            {
              key: "pending" as const,
              label: "Pending",
              count: pending.length,
              Icon: RotateCcw,
              iconWrap: "bg-blue-50",
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

      {/* Filters bar — jurisdiction + type chips grouped into one block with
          a single Clear filters action on the far right. */}
      <Card className="mb-6">
        <CardContent className="p-3 flex flex-wrap items-center gap-x-4 gap-y-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mr-1">
              Jurisdiction
            </span>
            <Link
              href={buildHref({ jurisdiction: null })}
              className={`text-xs rounded-full px-2.5 py-1 border transition-colors ${
                jurisdictionFilter === null
                  ? "bg-primary text-primary-foreground border-primary"
                  : "border-border hover:bg-muted"
              }`}
            >
              All
            </Link>
            {JURISDICTION_LEVELS.map((level) => (
              <Link
                key={level}
                href={buildHref({ jurisdiction: level })}
                className={`text-xs rounded-full px-2.5 py-1 border transition-colors ${
                  jurisdictionFilter === level
                    ? "bg-primary text-primary-foreground border-primary"
                    : "border-border hover:bg-muted"
                }`}
              >
                {level}
              </Link>
            ))}
          </div>
          <div className="hidden sm:block h-4 w-px bg-border" aria-hidden />
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mr-1">
              Type
            </span>
            <Link
              href={buildHref({ engagement: null })}
              className={`text-xs rounded-full px-2.5 py-1 border transition-colors ${
                engagementFilter === null
                  ? "bg-primary text-primary-foreground border-primary"
                  : "border-border hover:bg-muted"
              }`}
            >
              All
            </Link>
            {ENGAGEMENT_TYPES.map((t) => (
              <Link
                key={t}
                href={buildHref({ engagement: t })}
                className={`text-xs rounded-full px-2.5 py-1 border transition-colors ${
                  engagementFilter === t
                    ? "bg-primary text-primary-foreground border-primary"
                    : "border-border hover:bg-muted"
                }`}
              >
                {t}
              </Link>
            ))}
          </div>
          {hasAnyFilter && (
            <Link
              href="/certifications"
              className="ml-auto text-xs text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
            >
              Clear filters
            </Link>
          )}
        </CardContent>
      </Card>

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
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {visibleCerts.map((cert) => {
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
                      <StatusBadge status={cert.status} />
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
                      {cert.signedOffAt && (
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
                            ` ${format(cert.expirationDate, "MMM d, yyyy")}`}
                        </span>
                      )}
                      {isExpiring && (
                        <span className="flex items-center gap-1 text-yellow-600 font-medium">
                          <Clock className="h-3 w-3" /> {daysUntilExpiry}d until expiry
                        </span>
                      )}
                      {!isExpired && !isExpiring && cert.expirationDate && (
                        <span className="text-muted-foreground">
                          Expires {format(cert.expirationDate, "MMM d, yyyy")}
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
      )}
    </div>
  );
}
