import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { resolveModulePerms } from "@/lib/permissions";
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

interface PageProps {
  searchParams: Promise<{
    jurisdiction?: string;
    engagement?: string;
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

  const _perms = await resolveModulePerms(session.user.id, session.user.role, "certifications");

  const [certifications, clients, users] = await Promise.all([
    db.certification.findMany({
      where: {
        ...(jurisdictionFilter ? { jurisdictionLevel: jurisdictionFilter } : {}),
        ...(engagementFilter ? { engagementType: engagementFilter } : {}),
      },
      orderBy: [{ expirationDate: "asc" }],
      include: {
        client: { select: { id: true, name: true } },
        assignee: { select: { id: true, name: true } },
        pointOfContact: { select: { id: true, name: true } },
      },
    }),
    db.client.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
    db.user.findMany({
      where: { isActive: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);

  const now = new Date();

  // Breakdown stats
  const active = certifications.filter((c) => c.status === "ACTIVE");
  const expiringSoon = certifications.filter((c) => {
    if (!c.expirationDate) return false;
    const days = differenceInDays(c.expirationDate, now);
    return days > 0 && days <= (c.renewalLeadDays || 90);
  });
  const expired = certifications.filter((c) => {
    if (!c.expirationDate) return c.status === "EXPIRED";
    return differenceInDays(c.expirationDate, now) <= 0;
  });
  const pending = certifications.filter((c) => c.status === "PENDING");

  const canCreate =
    session.user.role === "ADMIN" ||
    session.user.role === "MANAGER" ||
    session.user.role === "DEVELOPER";

  const buildHref = (overrides: { jurisdiction?: string | null; engagement?: string | null }) => {
    const params = new URLSearchParams();
    const nextJuris = overrides.jurisdiction === undefined ? jurisdictionFilter : overrides.jurisdiction;
    const nextEng = overrides.engagement === undefined ? engagementFilter : overrides.engagement;
    if (nextJuris) params.set("jurisdiction", nextJuris);
    if (nextEng) params.set("engagement", nextEng);
    const qs = params.toString();
    return qs ? `/certifications?${qs}` : "/certifications";
  };

  return (
    <div>
      <PageHeader
        title="Certifications"
        description="Track certifications, renewals, and compliance"
        actions={canCreate ? <CertCreateButton clients={clients} users={users} /> : undefined}
      />

      {/* Summary breakdown */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 mb-6">
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-green-50">
              <CheckCircle2 className="h-5 w-5 text-green-600" />
            </div>
            <div>
              <p className="text-2xl font-bold">{active.length}</p>
              <p className="text-xs text-muted-foreground">Active</p>
            </div>
          </CardContent>
        </Card>
        <Card className={expiringSoon.length > 0 ? "border-warning/50" : ""}>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-yellow-50">
              <Clock className="h-5 w-5 text-yellow-600" />
            </div>
            <div>
              <p className="text-2xl font-bold">{expiringSoon.length}</p>
              <p className="text-xs text-muted-foreground">Expiring Soon</p>
            </div>
          </CardContent>
        </Card>
        <Card className={expired.length > 0 ? "border-destructive/50" : ""}>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-red-50">
              <XCircle className="h-5 w-5 text-red-600" />
            </div>
            <div>
              <p className="text-2xl font-bold">{expired.length}</p>
              <p className="text-xs text-muted-foreground">Expired</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-blue-50">
              <RotateCcw className="h-5 w-5 text-blue-600" />
            </div>
            <div>
              <p className="text-2xl font-bold">{pending.length}</p>
              <p className="text-xs text-muted-foreground">Pending</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 mb-6">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs font-medium text-muted-foreground mr-1">Jurisdiction:</span>
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
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs font-medium text-muted-foreground mr-1">Type:</span>
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
      </div>

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
      {certifications.length === 0 ? (
        <EmptyState
          icon={Award}
          title="No certifications yet"
          description={
            jurisdictionFilter || engagementFilter
              ? "No certifications match the current filters."
              : "Add your first certification to start tracking renewals"
          }
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {certifications.map((cert) => {
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
