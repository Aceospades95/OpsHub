import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireAuth, resolveModulePerms } from "@/lib/permissions";
import { getUserScope, canViewEntity } from "@/lib/scope";
import { AccessDenied } from "@/components/shared/access-denied";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/shared/status-badge";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, CalendarClock, CalendarX2, Gauge, User, Wrench } from "lucide-react";
import Link from "next/link";
import { formatCalendarDate } from "@/lib/dates";
import { formatCurrency } from "@/lib/quotes/totals";
import {
  vehicleLabel,
  maintenanceDueState,
  scheduleDueState,
  vehicleScheduleSummary,
  registrationDueState,
} from "@/lib/fleet";
import { VehicleActions } from "./vehicle-actions";
import { MaintenanceSection } from "./maintenance-section";
import { ServiceScheduleSection } from "./service-schedule-section";
import { LogMaintenanceButton } from "../log-maintenance-button";

interface Props {
  params: Promise<{ vehicleId: string }>;
}

export default async function VehicleDetailPage({ params }: Props) {
  const { vehicleId } = await params;
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

  // The vehicle fetch and the (perms-gated) editor dropdown are
  // independent — one round trip, not two.
  const [vehicle, users] = await Promise.all([
    db.vehicle.findFirst({
      where: { id: vehicleId, deletedAt: null },
      include: {
        assignedTo: { select: { id: true, name: true } },
        maintenanceRecords: { orderBy: { serviceDate: "desc" } },
        serviceSchedules: { orderBy: { serviceType: "asc" } },
      },
    }),
    perms.canEdit
      ? db.user.findMany({
          where: { isActive: true },
          select: { id: true, name: true },
          orderBy: { name: "asc" },
        })
      : Promise.resolve([] as { id: string; name: string }[]),
  ]);
  if (!vehicle) notFound();

  // Scoped viewers (assigned drivers / entity grants) only open their
  // own vehicles — same pattern as the tools module.
  const scope = await getUserScope(user.id, user.role);
  if (!canViewEntity(scope, "vehicle", vehicle.id)) {
    return <AccessDenied module="fleet" moduleLabel="Fleet" entityType="vehicle" entityId={vehicle.id} />;
  }

  const now = new Date();
  const legacyDueState = maintenanceDueState(vehicle, now);
  const summary = vehicleScheduleSummary(vehicle.serviceSchedules, vehicle, now);
  const registration = registrationDueState(vehicle, now);
  const totalCost = vehicle.maintenanceRecords.reduce((sum, r) => sum + (r.cost ?? 0), 0);

  // Vehicles with schedules get the schedule-derived badge; the legacy
  // single next-service date only drives the badge when no schedules
  // exist (mirrors the maintenance job's two paths).
  const hasSchedules = vehicle.serviceSchedules.length > 0;
  const serviceOverdue = hasSchedules ? summary.status === "overdue" : legacyDueState === "overdue";
  const serviceDueSoon = hasSchedules ? summary.status === "due-soon" : legacyDueState === "due-soon";

  // Drivers may log maintenance for their own vehicle without module
  // edit perms — the server action enforces the same rule.
  const canLog = perms.canEdit || vehicle.assignedToId === user.id;

  const scheduleRows = vehicle.serviceSchedules.map((schedule) => {
    const due = scheduleDueState(schedule, vehicle, now);
    return {
      id: schedule.id,
      serviceType: schedule.serviceType,
      everyMonths: schedule.everyMonths,
      everyMiles: schedule.everyMiles,
      lastServiceDate: schedule.lastServiceDate ? schedule.lastServiceDate.toISOString() : null,
      lastServiceMileage: schedule.lastServiceMileage,
      notes: schedule.notes,
      due: {
        dueDate: due.dueDate ? due.dueDate.toISOString() : null,
        dueMileage: due.dueMileage,
        status: due.status,
      },
    };
  });

  return (
    <div>
      <PageHeader
        title={vehicleLabel(vehicle)}
        description={vehicle.nickname ? `${vehicle.year} ${vehicle.make} ${vehicle.model}` : undefined}
        actions={
          <div className="flex items-center gap-2 flex-wrap">
            {canLog && (
              <LogMaintenanceButton
                vehicleId={vehicle.id}
                vehicleName={vehicleLabel(vehicle)}
                currentMileage={vehicle.currentMileage}
                scheduleServiceTypes={vehicle.serviceSchedules.map((s) => s.serviceType)}
              />
            )}
            <VehicleActions
              vehicle={{
                id: vehicle.id,
                nickname: vehicle.nickname,
                make: vehicle.make,
                model: vehicle.model,
                year: vehicle.year,
                vin: vehicle.vin,
                licensePlate: vehicle.licensePlate,
                status: vehicle.status,
                assignedToId: vehicle.assignedToId,
                currentMileage: vehicle.currentMileage,
                nextServiceDate: vehicle.nextServiceDate ? vehicle.nextServiceDate.toISOString() : null,
                nextServiceMileage: vehicle.nextServiceMileage,
                registrationExpiresAt: vehicle.registrationExpiresAt
                  ? vehicle.registrationExpiresAt.toISOString()
                  : null,
                notes: vehicle.notes,
              }}
              users={users}
              canEdit={perms.canEdit}
              canDelete={perms.canDelete}
            />
          </div>
        }
      />

      <div className="flex items-center gap-3 mb-6 flex-wrap">
        <StatusBadge status={vehicle.status} />
        {vehicle.licensePlate && <Badge variant="outline">{vehicle.licensePlate}</Badge>}
        {serviceOverdue && (
          <Badge variant="destructive" className="gap-1">
            <AlertTriangle className="h-3 w-3" />
            {summary.overdueCount > 1 ? `${summary.overdueCount} services overdue` : "Service overdue"}
          </Badge>
        )}
        {serviceDueSoon && (
          <Badge variant="warning" className="gap-1">
            <Wrench className="h-3 w-3" /> Service due soon
          </Badge>
        )}
        {registration.status === "overdue" && (
          <Badge variant="destructive" className="gap-1">
            <CalendarX2 className="h-3 w-3" /> Registration expired
          </Badge>
        )}
        {registration.status === "due-soon" && (
          <Badge variant="warning" className="gap-1">
            <CalendarClock className="h-3 w-3" />
            Registration expires in {registration.daysRemaining}d
          </Badge>
        )}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <CalendarClock className="h-4 w-4" />
                Service schedule ({vehicle.serviceSchedules.length})
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ServiceScheduleSection
                vehicleId={vehicle.id}
                schedules={scheduleRows}
                canEdit={perms.canEdit}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Wrench className="h-4 w-4" />
                Maintenance history ({vehicle.maintenanceRecords.length})
              </CardTitle>
            </CardHeader>
            <CardContent>
              <MaintenanceSection
                vehicleId={vehicle.id}
                records={vehicle.maintenanceRecords.map((record) => ({
                  id: record.id,
                  serviceDate: record.serviceDate.toISOString(),
                  serviceType: record.serviceType,
                  odometer: record.odometer,
                  cost: record.cost,
                  vendor: record.vendor,
                  notes: record.notes,
                  nextDueDate: record.nextDueDate ? record.nextDueDate.toISOString() : null,
                }))}
                canEdit={perms.canEdit}
                canDelete={perms.canDelete}
              />
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader><CardTitle>Details</CardTitle></CardHeader>
            <CardContent>
              <div className="space-y-3 text-sm">
                {vehicle.vin && (
                  <p className="text-muted-foreground">
                    <span className="text-xs uppercase tracking-wider">VIN</span>
                    <br />
                    <span className="font-mono text-foreground">{vehicle.vin}</span>
                  </p>
                )}
                {vehicle.currentMileage != null && (
                  <p className="flex items-center gap-2 text-muted-foreground">
                    <Gauge className="h-4 w-4" /> {vehicle.currentMileage.toLocaleString()} mi
                    {vehicle.mileageUpdatedAt && (
                      <span className="text-xs">
                        (as of {formatCalendarDate(vehicle.mileageUpdatedAt, "MMM d, yyyy")})
                      </span>
                    )}
                  </p>
                )}
                {vehicle.nextServiceDate && (
                  <p className="flex items-center gap-2 text-muted-foreground">
                    <CalendarClock className="h-4 w-4" />
                    Next service {formatCalendarDate(vehicle.nextServiceDate, "MMM d, yyyy")}
                    {vehicle.nextServiceMileage != null &&
                      ` (or ${vehicle.nextServiceMileage.toLocaleString()} mi)`}
                  </p>
                )}
                {vehicle.registrationExpiresAt && (
                  <p
                    className={`flex items-center gap-2 ${
                      registration.status === "overdue"
                        ? "text-destructive font-medium"
                        : registration.status === "due-soon"
                          ? "text-warning font-medium"
                          : "text-muted-foreground"
                    }`}
                  >
                    <CalendarX2 className="h-4 w-4" />
                    Registration {registration.status === "overdue" ? "expired" : "expires"}{" "}
                    {formatCalendarDate(vehicle.registrationExpiresAt, "MMM d, yyyy")}
                  </p>
                )}
                {vehicle.assignedTo && (
                  <p className="flex items-center gap-2 text-muted-foreground">
                    <User className="h-4 w-4" />
                    <Link href={`/team/${vehicle.assignedTo.id}`} className="hover:text-primary hover:underline">
                      {vehicle.assignedTo.name}
                    </Link>
                  </p>
                )}
                {totalCost > 0 && (
                  <p className="text-muted-foreground">
                    Lifetime maintenance:{" "}
                    <span className="text-foreground font-medium">
                      {formatCurrency(totalCost, "USD")}
                    </span>
                  </p>
                )}
              </div>
            </CardContent>
          </Card>

          {vehicle.notes && (
            <Card>
              <CardHeader><CardTitle>Notes</CardTitle></CardHeader>
              <CardContent>
                <p className="text-sm whitespace-pre-wrap">{vehicle.notes}</p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
