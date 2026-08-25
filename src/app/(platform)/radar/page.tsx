import { requireAuth, resolveModulePerms } from "@/lib/permissions";
import { getUserScope } from "@/lib/scope";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/shared/status-badge";
import { formatCalendarDate } from "@/lib/dates";
import { pluralizeWord } from "@/lib/pluralize";
import Link from "next/link";
import {
  Award,
  Car,
  Database,
  FileText,
  Handshake,
  HardHat,
  Target,
  type LucideIcon,
} from "lucide-react";
import {
  getRadarData,
  resolveRadarWindow,
  dueTone,
  daysRemainingLabel,
  RADAR_WINDOWS,
  type RadarModuleAccess,
  type VehicleRadarRow,
} from "@/lib/radar";

export const metadata = { title: "Renewal Radar · OpsHub" };

/**
 * /radar — one screen answering "what falls over in the next N days"
 * across contracts, certifications, subcontractor insurance,
 * partnership agreements, fleet, and bid deadlines, plus a data-gaps
 * strip. Read-only; every row links to its record.
 *
 * Gating mirrors /dashboard: any authenticated user gets the page, and
 * each section appears only when the viewer can see that module (same
 * resolveModulePerms + getUserScope filters the module list pages use).
 */

/** Days-remaining pill: red past due, amber ≤14d, muted otherwise. */
function DueBadge({ daysRemaining }: { daysRemaining: number }) {
  const tone = dueTone(daysRemaining);
  const variant =
    tone === "overdue" ? "destructive" : tone === "soon" ? "warning" : "outline";
  return <Badge variant={variant}>{daysRemainingLabel(daysRemaining)}</Badge>;
}

/** One radar row — whole row is the link to the record. */
function RadarRow({
  href,
  title,
  context,
  right,
}: {
  href: string;
  title: React.ReactNode;
  context?: React.ReactNode;
  right: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className="flex items-center justify-between gap-3 px-2 py-1.5 -mx-2 rounded hover:bg-muted/50 group"
    >
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium truncate group-hover:text-primary">{title}</p>
        {context && <p className="text-xs text-muted-foreground truncate">{context}</p>}
      </div>
      <div className="flex items-center gap-2 shrink-0 text-xs text-muted-foreground">
        {right}
      </div>
    </Link>
  );
}

function RadarSection({
  icon: Icon,
  title,
  count,
  overdueCount,
  viewAllHref,
  children,
}: {
  icon: LucideIcon;
  title: string;
  count: number;
  overdueCount: number;
  viewAllHref: string;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2">
            <Icon className="h-5 w-5" />
            {title}
            <Badge variant="secondary">{count}</Badge>
            {overdueCount > 0 && (
              <Badge variant="destructive">
                {overdueCount} overdue
              </Badge>
            )}
          </CardTitle>
          <Link href={viewAllHref} className="text-sm text-primary hover:underline shrink-0">
            View all
          </Link>
        </div>
      </CardHeader>
      <CardContent className="p-4 sm:px-6">
        <div className="divide-y divide-border">{children}</div>
      </CardContent>
    </Card>
  );
}

/** Service + registration chips for one vehicle row. */
function vehicleRight(v: VehicleRadarRow) {
  const chips: React.ReactNode[] = [];
  if (v.service) {
    const s = v.service;
    const parts: string[] = [];
    if (s.dueDate) parts.push(formatCalendarDate(s.dueDate, "MMM d, yyyy"));
    if (s.milesRemaining != null) {
      parts.push(
        s.milesRemaining <= 0
          ? `${(-s.milesRemaining).toLocaleString()} mi over`
          : `${s.milesRemaining.toLocaleString()} mi left`
      );
    }
    chips.push(
      <span key="svc" className="flex items-center gap-1.5">
        <span>
          {s.serviceType ?? "Service"}
          {parts.length > 0 && ` · ${parts.join(" · ")}`}
        </span>
        {s.daysRemaining != null ? (
          <DueBadge daysRemaining={s.daysRemaining} />
        ) : (
          <Badge variant={s.overdue ? "destructive" : "warning"}>
            {s.overdue ? "overdue" : "due soon"}
          </Badge>
        )}
        {s.overdueCount > 1 && (
          <Badge variant="destructive">+{s.overdueCount - 1} more</Badge>
        )}
      </span>
    );
  }
  if (v.registration) {
    chips.push(
      <span key="reg" className="flex items-center gap-1.5">
        <span>Registration · {formatCalendarDate(v.registration.expiresAt, "MMM d, yyyy")}</span>
        <DueBadge daysRemaining={v.registration.daysRemaining} />
      </span>
    );
  }
  return <span className="flex items-center gap-3 flex-wrap justify-end">{chips}</span>;
}

export default async function RadarPage({
  searchParams,
}: {
  searchParams: { days?: string };
}) {
  const user = await requireAuth();
  const windowDays = resolveRadarWindow(searchParams.days);
  const now = new Date();

  const [
    contractPerms,
    certPerms,
    subPerms,
    partnershipPerms,
    fleetPerms,
    bidPerms,
    clientPerms,
    projectPerms,
    scope,
  ] = await Promise.all([
    resolveModulePerms(user.id, user.role, "contracts"),
    resolveModulePerms(user.id, user.role, "certifications"),
    resolveModulePerms(user.id, user.role, "subcontractors"),
    resolveModulePerms(user.id, user.role, "partnerships"),
    resolveModulePerms(user.id, user.role, "fleet"),
    resolveModulePerms(user.id, user.role, "bids"),
    resolveModulePerms(user.id, user.role, "clients"),
    resolveModulePerms(user.id, user.role, "projects"),
    getUserScope(user.id, user.role),
  ]);

  const access: RadarModuleAccess = {
    contracts: contractPerms.canView,
    certifications: certPerms.canView,
    subcontractors: subPerms.canView,
    partnerships: partnershipPerms.canView,
    fleet: fleetPerms.canView,
    bids: bidPerms.canView,
    clients: clientPerms.canView,
    projects: projectPerms.canView,
  };

  const data = await getRadarData({ now, windowDays, scope, access });

  const certDue = data.certifications?.due ?? [];
  const certInFlight = data.certifications?.inFlight ?? [];

  // Header roll-up: total in-window items + how many are already past.
  const allDays: number[] = [
    ...(data.contracts ?? []).map((r) => r.daysRemaining),
    ...certDue.map((r) => r.daysRemaining),
    ...(data.subcontractors ?? []).map((r) => r.daysRemaining),
    ...(data.partnerships ?? []).map((r) => r.daysRemaining),
    ...(data.vehicles ?? []).map((r) => r.sortDays),
    ...(data.bids ?? []).map((r) => r.daysRemaining),
  ];
  const totalItems = allDays.length;
  const totalOverdue = allDays.filter((d) => d < 0).length;

  const emptySections: string[] = [];

  const sections: React.ReactNode[] = [];

  // ── 1. Contracts ────────────────────────────────────────────────
  if (data.contracts) {
    if (data.contracts.length === 0) {
      emptySections.push("Contracts");
    } else {
      sections.push(
        <RadarSection
          key="contracts"
          icon={FileText}
          title="Contracts"
          count={data.contracts.length}
          overdueCount={data.contracts.filter((c) => c.daysRemaining < 0).length}
          viewAllHref="/contracts"
        >
          {data.contracts.map((c) => (
            <RadarRow
              key={c.id}
              href={`/contracts/${c.id}`}
              title={c.title}
              context={c.clientName}
              right={
                <>
                  {c.noticePeriodDays != null && (
                    <Badge variant="outline">{c.noticePeriodDays}d notice</Badge>
                  )}
                  <span>
                    {c.kind === "end" ? "Ends" : "Renewal"}{" "}
                    {formatCalendarDate(c.date, "MMM d, yyyy")}
                  </span>
                  <DueBadge daysRemaining={c.daysRemaining} />
                </>
              }
            />
          ))}
        </RadarSection>
      );
    }
  }

  // ── 2. Certifications ───────────────────────────────────────────
  if (data.certifications) {
    if (certDue.length === 0 && certInFlight.length === 0) {
      emptySections.push("Certifications");
    } else {
      sections.push(
        <RadarSection
          key="certifications"
          icon={Award}
          title="Certifications"
          count={certDue.length}
          overdueCount={certDue.filter((c) => c.daysRemaining < 0).length}
          viewAllHref="/certifications"
        >
          {certDue.map((c) => (
            <RadarRow
              key={c.id}
              href={`/certifications/${c.id}`}
              title={c.name}
              context={c.clientName ?? undefined}
              right={
                <>
                  <span>Expires {formatCalendarDate(c.expirationDate, "MMM d, yyyy")}</span>
                  <DueBadge daysRemaining={c.daysRemaining} />
                </>
              }
            />
          ))}
          {certInFlight.length > 0 && (
            <div className="pt-2">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold py-1">
                Renewal in flight ({certInFlight.length})
              </p>
              <div className="divide-y divide-border opacity-70">
                {certInFlight.map((c) => (
                  <RadarRow
                    key={c.id}
                    href={`/certifications/${c.id}`}
                    title={c.name}
                    context={`Submitted ${formatCalendarDate(c.renewalSubmittedAt, "MMM d, yyyy")}`}
                    right={
                      <>
                        <span>
                          Expires {formatCalendarDate(c.expirationDate, "MMM d, yyyy")}
                        </span>
                        <Badge variant="outline">{daysRemainingLabel(c.daysRemaining)}</Badge>
                      </>
                    }
                  />
                ))}
              </div>
            </div>
          )}
        </RadarSection>
      );
    }
  }

  // ── 3. Subcontractor insurance ──────────────────────────────────
  if (data.subcontractors) {
    if (data.subcontractors.length === 0) {
      emptySections.push("Subcontractor insurance");
    } else {
      sections.push(
        <RadarSection
          key="subcontractors"
          icon={HardHat}
          title="Subcontractor Insurance"
          count={data.subcontractors.length}
          overdueCount={data.subcontractors.filter((s) => s.daysRemaining < 0).length}
          viewAllHref="/subcontractors"
        >
          {data.subcontractors.map((s) => (
            <RadarRow
              key={s.id}
              href={`/subcontractors/${s.id}`}
              title={
                <>
                  {s.name}
                  {s.status !== "ACTIVE" && (
                    <StatusBadge status={s.status} className="ml-2 text-[10px]" />
                  )}
                </>
              }
              right={
                <>
                  <span>
                    Insurance {formatCalendarDate(s.insuranceExpiresAt, "MMM d, yyyy")}
                  </span>
                  <DueBadge daysRemaining={s.daysRemaining} />
                </>
              }
            />
          ))}
        </RadarSection>
      );
    }
  }

  // ── 4. Partnership agreements ───────────────────────────────────
  if (data.partnerships) {
    if (data.partnerships.length === 0) {
      emptySections.push("Partnership agreements");
    } else {
      sections.push(
        <RadarSection
          key="partnerships"
          icon={Handshake}
          title="Partnership Agreements"
          count={data.partnerships.length}
          overdueCount={
            data.partnerships.filter((p) => !p.autoRenew && p.daysRemaining < 0).length
          }
          viewAllHref="/partnerships"
        >
          {data.partnerships.map((p) => (
            <RadarRow
              key={p.id}
              href={`/partnerships/${p.id}`}
              title={p.name}
              right={
                <>
                  <span>
                    Agreement {formatCalendarDate(p.agreementExpiresAt, "MMM d, yyyy")}
                  </span>
                  {p.autoRenew ? (
                    // Auto-renewing agreements roll over on their own —
                    // informational, not an alarm.
                    <Badge variant="success">
                      auto-renews {daysRemainingLabel(p.daysRemaining)}
                    </Badge>
                  ) : (
                    <DueBadge daysRemaining={p.daysRemaining} />
                  )}
                </>
              }
            />
          ))}
        </RadarSection>
      );
    }
  }

  // ── 5. Vehicles ─────────────────────────────────────────────────
  if (data.vehicles) {
    if (data.vehicles.length === 0) {
      emptySections.push("Vehicles");
    } else {
      sections.push(
        <RadarSection
          key="vehicles"
          icon={Car}
          title="Vehicles"
          count={data.vehicles.length}
          overdueCount={
            data.vehicles.filter(
              (v) => v.service?.overdue || v.registration?.overdue
            ).length
          }
          viewAllHref="/fleet"
        >
          {data.vehicles.map((v) => (
            <RadarRow
              key={v.id}
              href={`/fleet/${v.id}`}
              title={
                <>
                  {v.label}
                  {v.status !== "ACTIVE" && (
                    <StatusBadge status={v.status} className="ml-2 text-[10px]" />
                  )}
                </>
              }
              right={vehicleRight(v)}
            />
          ))}
        </RadarSection>
      );
    }
  }

  // ── 6. Bid deadlines ────────────────────────────────────────────
  if (data.bids) {
    if (data.bids.length === 0) {
      emptySections.push("Bid deadlines");
    } else {
      sections.push(
        <RadarSection
          key="bids"
          icon={Target}
          title="Bid Deadlines"
          count={data.bids.length}
          overdueCount={
            data.bids.filter((b) => b.daysRemaining < 0 && !b.stale).length
          }
          viewAllHref="/bids"
        >
          {data.bids.map((b) => (
            <RadarRow
              key={b.id}
              href={`/bids/${b.id}`}
              title={b.title}
              context={[b.agency, b.status === "IDENTIFIED" ? "Identified" : "Preparing"]
                .filter(Boolean)
                .join(" · ")}
              right={
                <>
                  <span>Due {formatCalendarDate(b.dueDate, "MMM d, yyyy")}</span>
                  {b.stale ? (
                    // >30d past with no submission recorded — probably a
                    // dead record, not a live deadline. Muted days pill +
                    // an explicit question mark instead of a red alarm.
                    <>
                      <Badge variant="outline">{daysRemainingLabel(b.daysRemaining)}</Badge>
                      <Badge variant="warning">stale?</Badge>
                    </>
                  ) : (
                    <DueBadge daysRemaining={b.daysRemaining} />
                  )}
                </>
              }
            />
          ))}
        </RadarSection>
      );
    }
  }

  // ── Data gaps ───────────────────────────────────────────────────
  const gapLines: Array<{ key: string; count: number; href: string; label: string }> = [];
  const g = data.gaps;
  if (g.clientsWithoutAccountManager != null && g.clientsWithoutAccountManager > 0) {
    gapLines.push({
      key: "clients-am",
      count: g.clientsWithoutAccountManager,
      href: "/clients",
      label: `active ${pluralizeWord(g.clientsWithoutAccountManager, "client")} without an account manager`,
    });
  }
  if (g.projectsWithoutEndDate != null && g.projectsWithoutEndDate > 0) {
    gapLines.push({
      key: "projects-end",
      count: g.projectsWithoutEndDate,
      href: "/projects",
      label: `planning/active ${pluralizeWord(g.projectsWithoutEndDate, "project")} without an end date — invisible to this radar`,
    });
  }
  if (g.projectsWithoutServiceOffering != null && g.projectsWithoutServiceOffering > 0) {
    gapLines.push({
      key: "projects-offering",
      count: g.projectsWithoutServiceOffering,
      href: "/projects",
      label: `${pluralizeWord(g.projectsWithoutServiceOffering, "project")} without a service offering`,
    });
  }
  if (g.wonBidsUnlinked != null && g.wonBidsUnlinked > 0) {
    gapLines.push({
      key: "bids-unlinked",
      count: g.wonBidsUnlinked,
      href: "/bids",
      label: `won ${pluralizeWord(g.wonBidsUnlinked, "bid")} not linked to a project or contract`,
    });
  }
  if (g.activeSubcontractorsUnassigned != null && g.activeSubcontractorsUnassigned > 0) {
    gapLines.push({
      key: "subs-unassigned",
      count: g.activeSubcontractorsUnassigned,
      href: "/subcontractors",
      label: `active ${pluralizeWord(g.activeSubcontractorsUnassigned, "subcontractor")} with no project ${pluralizeWord(g.activeSubcontractorsUnassigned, "assignment")}`,
    });
  }

  return (
    <div>
      <PageHeader
        title="Renewal Radar"
        description={`${totalItems} item${totalItems !== 1 ? "s" : ""} due in the next ${windowDays} days${
          totalOverdue > 0 ? ` · ${totalOverdue} already overdue` : ""
        }`}
        actions={
          <div className="flex items-center gap-1" aria-label="Look-ahead window">
            <span className="text-xs text-muted-foreground mr-1">Window</span>
            {RADAR_WINDOWS.map((w) => {
              const active = w === windowDays;
              return (
                <Link
                  key={w}
                  href={`/radar?days=${w}`}
                  aria-current={active ? "page" : undefined}
                  className={`rounded-md border px-2.5 py-1 text-xs font-medium transition-colors ${
                    active
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border text-muted-foreground hover:text-foreground hover:border-primary/50"
                  }`}
                >
                  {w}d
                </Link>
              );
            })}
          </div>
        }
      />

      <div className="space-y-4">
        {sections}

        {sections.length === 0 && (
          <Card>
            <CardContent className="p-6 text-sm text-muted-foreground">
              Nothing on the radar for the next {windowDays} days.
            </CardContent>
          </Card>
        )}

        {emptySections.length > 0 && (
          <div className="text-xs text-muted-foreground space-y-0.5 px-1">
            {emptySections.map((label) => (
              <p key={label}>
                {label} — nothing due or overdue in the next {windowDays} days.
              </p>
            ))}
          </div>
        )}

        {gapLines.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Database className="h-5 w-5" />
                What&apos;s blocking better answers
                <Badge variant="secondary">{gapLines.length}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4 sm:px-6">
              <div className="space-y-1.5 text-sm">
                {gapLines.map((line) => (
                  <p key={line.key}>
                    <Link href={line.href} className="hover:text-primary hover:underline">
                      <strong>{line.count}</strong> {line.label}
                    </Link>
                  </p>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
