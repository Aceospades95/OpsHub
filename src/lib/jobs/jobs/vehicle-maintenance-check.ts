/**
 * vehicle-maintenance-check
 *
 * Notifies when a vehicle enters its service window (due within 14 days)
 * or is overdue. Recipients: active admins + managers, plus the assigned
 * driver when one is set. Deduped via Vehicle.maintenanceNotifiedFor —
 * one notification per nextServiceDate value; logging service (or
 * changing the date) re-arms it.
 */

import { db } from "@/lib/db";
import { log } from "@/lib/log";
import { notify } from "@/lib/notifications";
import { absoluteUrl } from "@/lib/url";
import { differenceInDays } from "date-fns";
import { vehicleLabel, MAINTENANCE_DUE_WINDOW_DAYS } from "@/lib/fleet";
import { shouldRunDaily } from "../gating";
import type { JobDefinition } from "../types";

export const vehicleMaintenanceCheck: JobDefinition = {
  key: "vehicle-maintenance-check",
  name: "Vehicle maintenance check",
  description:
    "Notifies admins/managers (and the assigned driver) when a vehicle's next service is due within 14 days or overdue",
  schedule: "Daily",

  async handler() {
    if (!(await shouldRunDaily("vehicle-maintenance-check"))) {
      return { status: "skipped", output: "Already ran today", processed: 0 };
    }
    const now = new Date();
    const horizon = new Date(now.getTime() + MAINTENANCE_DUE_WINDOW_DAYS * 24 * 60 * 60 * 1000);

    const vehicles = await db.vehicle.findMany({
      where: {
        deletedAt: null,
        status: { in: ["ACTIVE", "IN_SHOP"] },
        nextServiceDate: { not: null, lte: horizon },
      },
      include: { assignedTo: { select: { id: true, name: true } } },
    });

    if (vehicles.length === 0) {
      return { output: "No vehicles in the service window", processed: 0 };
    }

    const managers = await db.user.findMany({
      where: { isActive: true, role: { in: ["ADMIN", "MANAGER"] } },
      select: { id: true },
    });

    let notified = 0;
    for (const vehicle of vehicles) {
      if (!vehicle.nextServiceDate) continue;
      // Already notified for this exact service date — re-arms when the
      // date changes (service logged / schedule edited).
      if (
        vehicle.maintenanceNotifiedFor &&
        vehicle.maintenanceNotifiedFor.getTime() === vehicle.nextServiceDate.getTime()
      ) {
        continue;
      }

      const days = differenceInDays(vehicle.nextServiceDate, now);
      const label = vehicleLabel(vehicle);
      const title =
        days < 0
          ? `Vehicle maintenance overdue: ${label}`
          : `Vehicle maintenance due in ${days} day${days === 1 ? "" : "s"}: ${label}`;
      const body = vehicle.licensePlate ? `${label} · ${vehicle.licensePlate}` : label;

      const recipientIds = Array.from(
        new Set([...managers.map((m) => m.id), ...(vehicle.assignedTo ? [vehicle.assignedTo.id] : [])])
      );

      try {
        await notify({
          recipientId: recipientIds,
          type: "vehicle-maintenance-due",
          title,
          body,
          href: `/fleet/${vehicle.id}`,
          entityType: "vehicle",
          entityId: vehicle.id,
          email: {
            templateKey: "notification",
            data: {
              recipientName: "there",
              heading: title,
              body: `${label} has service scheduled for ${vehicle.nextServiceDate.toDateString()}. Log the maintenance in OpsHub once it's done to reset the schedule.`,
              cta: { label: "Open vehicle", url: absoluteUrl(`/fleet/${vehicle.id}`) },
            },
          },
        });
        notified += 1;
        await db.vehicle.update({
          where: { id: vehicle.id },
          data: { maintenanceNotifiedFor: vehicle.nextServiceDate },
        });
      } catch (err) {
        log.error("jobs.vehicleMaintenance", "Notify failed", err, { vehicleId: vehicle.id });
      }
    }

    return {
      output: `Checked ${vehicles.length} vehicle${vehicles.length === 1 ? "" : "s"}, notified on ${notified}`,
      processed: notified,
    };
  },
};
