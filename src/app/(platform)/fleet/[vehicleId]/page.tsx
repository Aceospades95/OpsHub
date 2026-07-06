import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireAuth, resolveModulePerms } from "@/lib/permissions";
import { AccessDenied } from "@/components/shared/access-denied";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/shared/status-badge";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, CalendarClock, Gauge, User, Wrench } from "lucide-react";
import Link from "next/link";
import { formatCalendarDate } from "@/lib/dates";
import { vehicleLabel, maintenanceDueState } from "@/lib/fleet";
import { VehicleActions } from "./vehicle-actions";
import { MaintenanceSection } from "./maintenance-section";

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

  const vehicle = await db.vehicle.findFirst({
    where: { id: vehicleId, deletedAt: null },
    include: {
      assignedTo: { select: { id: true, name: true } },
      maintenanceRecords: { orderBy: { serviceDate: "desc" } },
    },
  });
  if (!vehicle) notFound();

  const users = perms.canEdit
    ? await db.user.findMany({
        where: { isActive: true },
        select: { id: true, name: true },
        orderBy: { name: "asc" },
      })
    : [];

  const now = new Date();
  const dueState = maintenanceDueState(vehicle, now);
  const totalCost = vehicle.maintenanceRecords.reduce((sum, r) => sum + (r.cost ?? 0), 0);

  return (
    <div>
      <PageHeader
        title={vehicleLabel(vehicle)}
        description={vehicle.nickname ? `${vehicle.year} ${vehicle.make} ${vehicle.model}` : undefined}
        actions={
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
              notes: vehicle.notes,
            }}
            users={users}
            canEdit={perms.canEdit}
            canDelete={perms.canDelete}
          />
        }
      />

      <div className="flex items-center gap-3 mb-6 flex-wrap">
        <StatusBadge status={vehicle.status} />
        {vehicle.licensePlate && <Badge variant="outline">{vehicle.licensePlate}</Badge>}
        {dueState === "overdue" && (
          <Badge variant="destructive" className="gap-1">
            <AlertTriangle className="h-3 w-3" /> Service overdue
          </Badge>
        )}
        {dueState === "due-soon" && (
          <Badge variant="warning" className="gap-1">
            <Wrench className="h-3 w-3" /> Service due soon
          </Badge>
        )}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-6">
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
                      {totalCost.toLocaleString("en-US", { style: "currency", currency: "USD" })}
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
