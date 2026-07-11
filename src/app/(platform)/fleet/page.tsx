import { db } from "@/lib/db";
import { requireAuth, resolveModulePerms } from "@/lib/permissions";
import { getUserScope } from "@/lib/scope";
import { AccessDenied } from "@/components/shared/access-denied";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { StatusBadge } from "@/components/shared/status-badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Badge } from "@/components/ui/badge";
import { Car, Wrench, AlertTriangle, CalendarClock, User } from "lucide-react";
import Link from "next/link";
import { formatCalendarDate } from "@/lib/dates";
import { resolveViewPreference } from "@/lib/view-preference";
import { ViewOptionsBar } from "@/components/shared/view-options-bar";
import { GroupSection } from "@/components/shared/group-section";
import { groupRows } from "@/lib/group-rows";
import {
  vehicleLabel,
  maintenanceDueState,
  vehicleScheduleSummary,
  registrationDueState,
  type MaintenanceDueState,
  type VehicleScheduleSummary,
  type RegistrationDueStatus,
} from "@/lib/fleet";
import { VehicleCreateButton } from "./vehicle-create-button";
import { LogMaintenanceButton } from "./log-maintenance-button";
import type { Prisma } from "@prisma/client";

type VehicleRow = Prisma.VehicleGetPayload<{
  include: {
    assignedTo: { select: { id: true; name: true } };
    serviceSchedules: true;
  };
}>;

/** Everything a row badge needs, computed once per vehicle. */
interface RowDue {
  /** Combined worst bucket across schedules, legacy date, registration. */
  bucket: "overdue" | "due-soon" | null;
  summary: VehicleScheduleSummary;
  legacy: MaintenanceDueState;
  registration: { status: RegistrationDueStatus; daysRemaining: number | null };
}

const GROUP_OPTIONS = [
  { value: "status", label: "Status" },
  { value: "make", label: "Make" },
  { value: "assignee", label: "Assigned to" },
] as const;
type GroupKey = (typeof GROUP_OPTIONS)[number]["value"];

const DUE_FILTERS = ["overdue", "due-soon"] as const;
type DueFilter = (typeof DUE_FILTERS)[number];

function humanizeEnum(value: string): string {
  return value
    .split("_")
    .map((w) => w.charAt(0) + w.slice(1).toLowerCase())
    .join(" ");
}

export const metadata = { title: "Fleet · OpsHub" };

export default async function FleetPage({
  searchParams,
}: {
  searchParams: { view?: string; groupBy?: string; due?: string };
}) {
  const user = await requireAuth();

  const perms = await resolveModulePerms(user.id, user.role, "fleet");
  if (!perms.canView) {
    return (
      <AccessDenied
        module="fleet"
        moduleLabel="Fleet"
        moduleDescription="Company vehicles, maintenance records, and service alerts"
      />
    );
  }

  const view = resolveViewPreference(searchParams.view, "fleet", ["table", "cards"], "table");
  const groupBy = GROUP_OPTIONS.some((o) => o.value === searchParams.groupBy)
    ? (searchParams.groupBy as GroupKey)
    : null;
  const dueFilter = DUE_FILTERS.includes(searchParams.due as DueFilter)
    ? (searchParams.due as DueFilter)
    : null;

  // Scoped viewers (e.g. an assigned driver whose canView comes from the
  // vehicle scope grant) only see their own vehicles.
  const scope = await getUserScope(user.id, user.role);
  const vehicleWhere: Prisma.VehicleWhereInput = { deletedAt: null };
  if (!scope.all) {
    vehicleWhere.id = { in: Array.from(scope.vehicleIds) };
  }

  const [vehicles, users] = await Promise.all([
    db.vehicle.findMany({
      where: vehicleWhere,
      orderBy: [{ status: "asc" }, { make: "asc" }, { model: "asc" }],
      include: {
        assignedTo: { select: { id: true, name: true } },
        serviceSchedules: true,
      },
    }),
    perms.canCreate
      ? db.user.findMany({
          where: { isActive: true },
          select: { id: true, name: true },
          orderBy: { name: "asc" },
        })
      : Promise.resolve([] as { id: string; name: string }[]),
  ]);

  const now = new Date();
  const rowDue = new Map<string, RowDue>(
    vehicles.map((vehicle) => {
      const summary = vehicleScheduleSummary(vehicle.serviceSchedules, vehicle, now);
      const legacy = maintenanceDueState(vehicle, now);
      const registration = registrationDueState(vehicle, now);
      // Vehicles with schedules use the per-service-type roll-up; the
      // legacy single next-service date only applies without schedules
      // (mirrors the maintenance job's two paths).
      const serviceState = vehicle.serviceSchedules.length > 0 ? summary.status : legacy;
      const bucket =
        serviceState === "overdue" || registration.status === "overdue"
          ? ("overdue" as const)
          : serviceState === "due-soon" || registration.status === "due-soon"
            ? ("due-soon" as const)
            : null;
      return [vehicle.id, { bucket, summary, legacy, registration }];
    })
  );
  const dueOf = (vehicle: VehicleRow): RowDue => rowDue.get(vehicle.id)!;
  const overdue = vehicles.filter((v) => dueOf(v).bucket === "overdue");
  const dueSoon = vehicles.filter((v) => dueOf(v).bucket === "due-soon");

  const visibleVehicles = dueFilter
    ? vehicles.filter((v) => dueOf(v).bucket === dueFilter)
    : vehicles;

  const groupKeyOf = (vehicle: VehicleRow, key: GroupKey): string | null => {
    switch (key) {
      case "status":
        return humanizeEnum(vehicle.status);
      case "make":
        return vehicle.make;
      case "assignee":
        return vehicle.assignedTo?.name ?? null;
    }
  };

  const buildDueHref = (target: DueFilter | null) => {
    const params = new URLSearchParams();
    if (target) params.set("due", target);
    if (view !== "cards") params.set("view", view);
    if (groupBy) params.set("groupBy", groupBy);
    const qs = params.toString();
    return qs ? `/fleet?${qs}` : "/fleet";
  };

  /** "Jun 3, 2026" / "45,200 mi" / "Jun 3, 2026 / 45,200 mi". */
  const nextDueText = (item: VehicleScheduleSummary["nextDue"]) => {
    if (!item) return "";
    const parts: string[] = [];
    if (item.state.dueDate) parts.push(formatCalendarDate(item.state.dueDate, "MMM d, yyyy"));
    if (item.state.dueMileage != null) parts.push(`${item.state.dueMileage.toLocaleString()} mi`);
    return parts.join(" / ");
  };

  const serviceLine = (vehicle: VehicleRow) => {
    const due = dueOf(vehicle);

    // Legacy single-date path for vehicles with no schedules.
    if (vehicle.serviceSchedules.length === 0) {
      if (!vehicle.nextServiceDate)
        return <span className="text-muted-foreground">No service scheduled</span>;
      const dateText = formatCalendarDate(vehicle.nextServiceDate, "MMM d, yyyy");
      if (due.legacy === "overdue") {
        return (
          <span className="flex items-center gap-1 text-destructive font-medium">
            <AlertTriangle className="h-3 w-3" /> Service overdue ({dateText})
          </span>
        );
      }
      if (due.legacy === "due-soon") {
        return (
          <span className="flex items-center gap-1 text-warning font-medium">
            <Wrench className="h-3 w-3" /> Service due {dateText}
          </span>
        );
      }
      return <span className="text-muted-foreground">Next service {dateText}</span>;
    }

    const { summary } = due;
    const text = nextDueText(summary.nextDue);
    if (summary.status === "overdue") {
      const label =
        summary.overdueCount > 1
          ? `${summary.overdueCount} services overdue`
          : `${summary.nextDue?.serviceType ?? "Service"} overdue`;
      return (
        <span className="flex items-center gap-1 text-destructive font-medium">
          <AlertTriangle className="h-3 w-3" /> {label}
          {text && ` (${text})`}
        </span>
      );
    }
    if (summary.status === "due-soon" && summary.nextDue) {
      return (
        <span className="flex items-center gap-1 text-warning font-medium">
          <Wrench className="h-3 w-3" /> {summary.nextDue.serviceType} due{text && ` ${text}`}
        </span>
      );
    }
    if (summary.status === "unknown" || !summary.nextDue) {
      return <span className="text-muted-foreground">Schedules need a baseline</span>;
    }
    return (
      <span className="text-muted-foreground">
        Next: {summary.nextDue.serviceType}
        {text && ` (${text})`}
      </span>
    );
  };

  const registrationLine = (vehicle: VehicleRow) => {
    const { registration } = dueOf(vehicle);
    if (registration.status !== "overdue" && registration.status !== "due-soon") return null;
    const dateText = formatCalendarDate(vehicle.registrationExpiresAt, "MMM d, yyyy");
    return registration.status === "overdue" ? (
      <span className="flex items-center gap-1 text-destructive font-medium">
        <CalendarClock className="h-3 w-3" /> Registration expired ({dateText})
      </span>
    ) : (
      <span className="flex items-center gap-1 text-warning font-medium">
        <CalendarClock className="h-3 w-3" /> Registration expires {dateText}
      </span>
    );
  };

  // Assigned drivers get a "Log maintenance" shortcut on their own row
  // (the server action allows exactly that pairing; editors use the
  // detail page).
  const logButton = (vehicle: VehicleRow, variant: "default" | "outline" = "outline") => (
    <LogMaintenanceButton
      vehicleId={vehicle.id}
      vehicleName={vehicleLabel(vehicle)}
      currentMileage={vehicle.currentMileage}
      scheduleServiceTypes={vehicle.serviceSchedules.map((s) => s.serviceType)}
      variant={variant}
      size="sm"
    />
  );

  const renderCards = (rows: VehicleRow[]) => (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {rows.map((vehicle) => {
        const bucket = dueOf(vehicle).bucket;
        const isMine = vehicle.assignedToId === user.id;
        return (
          <div key={vehicle.id} className="relative">
            <Link href={`/fleet/${vehicle.id}`}>
              <Card
                className={`hover:shadow-md transition-shadow h-full ${
                  bucket === "overdue"
                    ? "border-destructive/50"
                    : bucket === "due-soon"
                      ? "border-warning/50"
                      : ""
                }`}
              >
                <CardContent className={`p-5 ${isMine ? "pb-14" : ""}`}>
                  <div className="flex items-start justify-between mb-2">
                    <div className="min-w-0">
                      <h3 className="font-semibold text-foreground truncate">{vehicleLabel(vehicle)}</h3>
                      {vehicle.nickname && (
                        <p className="text-xs text-muted-foreground">
                          {vehicle.year} {vehicle.make} {vehicle.model}
                        </p>
                      )}
                    </div>
                    <StatusBadge status={vehicle.status} />
                  </div>
                  <div className="flex items-center gap-2 flex-wrap mb-3">
                    {vehicle.licensePlate && <Badge variant="outline">{vehicle.licensePlate}</Badge>}
                    {vehicle.vin && (
                      <span className="text-xs text-muted-foreground font-mono">VIN {vehicle.vin}</span>
                    )}
                  </div>
                  <div className="space-y-1 text-xs">
                    {serviceLine(vehicle)}
                    {registrationLine(vehicle)}
                    {vehicle.assignedTo && (
                      <p className="flex items-center gap-1 text-muted-foreground">
                        <User className="h-3 w-3" /> {vehicle.assignedTo.name}
                      </p>
                    )}
                    {vehicle.currentMileage != null && (
                      <p className="text-muted-foreground">
                        {vehicle.currentMileage.toLocaleString()} mi
                      </p>
                    )}
                  </div>
                </CardContent>
              </Card>
            </Link>
            {/* Sibling of the Link (not a child) so opening the dialog
                never navigates — the Dialog renders inline, not in a
                portal. Only the viewer's own vehicle gets the shortcut
                here; editors use the detail page. */}
            {isMine && (
              <div className="absolute bottom-3 right-3">{logButton(vehicle)}</div>
            )}
          </div>
        );
      })}
    </div>
  );

  const renderTable = (rows: VehicleRow[]) => {
    const anyLoggable = rows.some((v) => v.assignedToId === user.id);
    return (
      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted-foreground">
                <th className="p-3 font-medium">Vehicle</th>
                <th className="p-3 font-medium">Plates</th>
                <th className="p-3 font-medium">VIN</th>
                <th className="p-3 font-medium">Assigned to</th>
                <th className="p-3 font-medium text-right">Mileage</th>
                <th className="p-3 font-medium">Next service</th>
                <th className="p-3 font-medium">Status</th>
                {anyLoggable && <th className="p-3 font-medium" />}
              </tr>
            </thead>
            <tbody>
              {rows.map((vehicle) => (
                <tr key={vehicle.id} className="border-b border-border last:border-0 hover:bg-muted/50">
                  <td className="p-3">
                    <Link href={`/fleet/${vehicle.id}`} className="font-medium hover:text-primary hover:underline">
                      {vehicleLabel(vehicle)}
                    </Link>
                    {vehicle.nickname && (
                      <div className="text-xs text-muted-foreground">
                        {vehicle.year} {vehicle.make} {vehicle.model}
                      </div>
                    )}
                  </td>
                  <td className="p-3 text-muted-foreground">{vehicle.licensePlate || "—"}</td>
                  <td className="p-3 text-muted-foreground font-mono text-xs">{vehicle.vin || "—"}</td>
                  <td className="p-3 text-muted-foreground">
                    {vehicle.assignedTo ? (
                      <Link href={`/team/${vehicle.assignedTo.id}`} className="hover:text-primary hover:underline">
                        {vehicle.assignedTo.name}
                      </Link>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="p-3 text-right tabular-nums text-muted-foreground">
                    {vehicle.currentMileage != null ? vehicle.currentMileage.toLocaleString() : "—"}
                  </td>
                  <td className="p-3 text-xs">
                    <div className="space-y-0.5">
                      {serviceLine(vehicle)}
                      {registrationLine(vehicle)}
                    </div>
                  </td>
                  <td className="p-3"><StatusBadge status={vehicle.status} /></td>
                  {anyLoggable && (
                    <td className="p-3 text-right">
                      {vehicle.assignedToId === user.id ? logButton(vehicle) : null}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    );
  };

  const renderRows = view === "table" ? renderTable : renderCards;
  const groups = groupBy ? groupRows(visibleVehicles, (v) => groupKeyOf(v, groupBy)) : null;

  return (
    <div>
      <PageHeader
        title="Fleet"
        description="Company vehicles, maintenance history, and service schedule"
        actions={perms.canCreate ? <VehicleCreateButton users={users} /> : undefined}
      />

      {/* Due-maintenance chips — tap to filter, mirroring the cert page. */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 mb-6">
        {(
          [
            {
              key: null,
              label: "Vehicles",
              count: vehicles.length,
              Icon: Car,
              iconWrap: "bg-primary/10",
              iconColor: "text-primary",
              border: "",
            },
            {
              key: "due-soon" as const,
              label: "Service Due Soon",
              count: dueSoon.length,
              Icon: CalendarClock,
              iconWrap: "bg-warning/15",
              iconColor: "text-warning",
              border: dueSoon.length > 0 ? "border-warning/50" : "",
            },
            {
              key: "overdue" as const,
              label: "Overdue",
              count: overdue.length,
              Icon: AlertTriangle,
              iconWrap: "bg-destructive/10",
              iconColor: "text-destructive",
              border: overdue.length > 0 ? "border-destructive/50" : "",
            },
          ] as const
        ).map((stat) => {
          const isActive = dueFilter === stat.key || (stat.key === null && !dueFilter);
          return (
            <Link
              key={stat.label}
              href={buildDueHref(dueFilter === stat.key ? null : stat.key)}
              aria-pressed={isActive}
            >
              <Card
                className={`transition-shadow hover:shadow-md ${
                  isActive && stat.key !== null ? "border-primary ring-1 ring-primary/40" : stat.border
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

      <ViewOptionsBar
        view={view}
        viewOptions={[
          { value: "table", label: "Table" },
          { value: "cards", label: "Cards" },
        ]}
        storageKey="fleet"
        groupBy={groupBy}
        groupByOptions={[...GROUP_OPTIONS]}
      />

      {visibleVehicles.length === 0 ? (
        <EmptyState
          icon={Car}
          title={dueFilter ? "Nothing in this bucket" : "No vehicles yet"}
          description={
            dueFilter
              ? "No vehicles match the selected service filter."
              : "Add your first vehicle to start tracking the fleet"
          }
        />
      ) : groups ? (
        groups.map((group) => (
          <GroupSection key={group.label} label={group.label} count={group.rows.length}>
            {renderRows(group.rows)}
          </GroupSection>
        ))
      ) : (
        renderRows(visibleVehicles)
      )}
    </div>
  );
}
