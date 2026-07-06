import { db } from "@/lib/db";
import { requireAuth, resolveModulePerms } from "@/lib/permissions";
import { AccessDenied } from "@/components/shared/access-denied";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { StatusBadge } from "@/components/shared/status-badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Badge } from "@/components/ui/badge";
import { Car, Wrench, AlertTriangle, CalendarClock, User } from "lucide-react";
import Link from "next/link";
import { formatCalendarDate } from "@/lib/dates";
import { ViewOptionsBar } from "@/components/shared/view-options-bar";
import { GroupSection } from "@/components/shared/group-section";
import { groupRows } from "@/lib/group-rows";
import { vehicleLabel, maintenanceDueState, type MaintenanceDueState } from "@/lib/fleet";
import { VehicleCreateButton } from "./vehicle-create-button";
import type { Prisma } from "@prisma/client";

type VehicleRow = Prisma.VehicleGetPayload<{
  include: { assignedTo: { select: { id: true; name: true } } };
}>;

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

  const view = searchParams.view === "table" ? "table" : "cards";
  const groupBy = GROUP_OPTIONS.some((o) => o.value === searchParams.groupBy)
    ? (searchParams.groupBy as GroupKey)
    : null;
  const dueFilter = DUE_FILTERS.includes(searchParams.due as DueFilter)
    ? (searchParams.due as DueFilter)
    : null;

  const [vehicles, users] = await Promise.all([
    db.vehicle.findMany({
      where: { deletedAt: null },
      orderBy: [{ status: "asc" }, { make: "asc" }, { model: "asc" }],
      include: { assignedTo: { select: { id: true, name: true } } },
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
  const dueStates = new Map<string, MaintenanceDueState>(
    vehicles.map((vehicle) => [vehicle.id, maintenanceDueState(vehicle, now)])
  );
  const overdue = vehicles.filter((v) => dueStates.get(v.id) === "overdue");
  const dueSoon = vehicles.filter((v) => dueStates.get(v.id) === "due-soon");

  const visibleVehicles = dueFilter
    ? vehicles.filter((v) => dueStates.get(v.id) === dueFilter)
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

  const serviceLine = (vehicle: VehicleRow) => {
    const state = dueStates.get(vehicle.id);
    if (!vehicle.nextServiceDate) return <span className="text-muted-foreground">No service scheduled</span>;
    const dateText = formatCalendarDate(vehicle.nextServiceDate, "MMM d, yyyy");
    if (state === "overdue") {
      return (
        <span className="flex items-center gap-1 text-destructive font-medium">
          <AlertTriangle className="h-3 w-3" /> Service overdue ({dateText})
        </span>
      );
    }
    if (state === "due-soon") {
      return (
        <span className="flex items-center gap-1 text-warning font-medium">
          <Wrench className="h-3 w-3" /> Service due {dateText}
        </span>
      );
    }
    return <span className="text-muted-foreground">Next service {dateText}</span>;
  };

  const renderCards = (rows: VehicleRow[]) => (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {rows.map((vehicle) => {
        const state = dueStates.get(vehicle.id);
        return (
          <Link key={vehicle.id} href={`/fleet/${vehicle.id}`}>
            <Card
              className={`hover:shadow-md transition-shadow h-full ${
                state === "overdue" ? "border-destructive/50" : state === "due-soon" ? "border-warning/50" : ""
              }`}
            >
              <CardContent className="p-5">
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
        );
      })}
    </div>
  );

  const renderTable = (rows: VehicleRow[]) => (
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
                <td className="p-3 text-xs">{serviceLine(vehicle)}</td>
                <td className="p-3"><StatusBadge status={vehicle.status} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );

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
          { value: "cards", label: "Cards" },
          { value: "table", label: "Table" },
        ]}
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
