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
import { formatCalendarDate } from "@/lib/dates";
import { vehicleLabel, MAINTENANCE_DUE_WINDOW_DAYS } from "@/lib/fleet";
import { shouldRunDaily } from "../gating";
import type { JobDefinition } from "../types";

export const vehicleMaintenanceCheck: JobDefinition = {
  key: "vehicle-maintenance-check",
  name: "Vehicle maintenance check",
  description:
    "Notifies admins/managers (and the assigned driver) when a vehicle's next service is due within 14 days or overdue",
  schedule: "Daily",
  supportsDryRun: true,

  async handler(ctx) {
    if (!ctx.dryRun && !(await shouldRunDaily("vehicle-maintenance-check"))) {
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
      return {
        output: `No vehicles with a next-service date inside the ${MAINTENANCE_DUE_WINDOW_DAYS}-day window`,
        processed: 0,
      };
    }

    const managers = await db.user.findMany({
      where: { isActive: true, role: { in: ["ADMIN", "MANAGER"] } },
      select: { id: true, name: true },
    });

    let notified = 0;
    const detail: string[] = [];
    for (const vehicle of vehicles) {
      if (!vehicle.nextServiceDate) continue;
      const days = differenceInDays(vehicle.nextServiceDate, now);
      const label = vehicleLabel(vehicle);
      // Already notified for this exact service date — re-arms when the
      // date changes (service logged / schedule edited).
      if (
        vehicle.maintenanceNotifiedFor &&
        vehicle.maintenanceNotifiedFor.getTime() === vehicle.nextServiceDate.getTime()
      ) {
        detail.push(
          `· ${label}: service ${days < 0 ? `${-days}d overdue` : `due in ${days}d`} — already notified for this date (logging service re-arms it)`
        );
        continue;
      }
      const title =
        days < 0
          ? `Vehicle maintenance overdue: ${label}`
          : `Vehicle maintenance due in ${days} day${days === 1 ? "" : "s"}: ${label}`;
      const body = vehicle.licensePlate ? `${label} · ${vehicle.licensePlate}` : label;
      // Calendar date — server-local toDateString() would name the
      // previous day on hosts west of UTC.
      const serviceDay = formatCalendarDate(vehicle.nextServiceDate, "MMMM d, yyyy");

      // One notify() per recipient (the certification-expiry pattern) so
      // each email greets the person by name. Assigned drivers can open
      // the link — vehicle assignment grants scoped view of the vehicle.
      const recipients = new Map(managers.map((m) => [m.id, m.name]));
      if (vehicle.assignedTo) recipients.set(vehicle.assignedTo.id, vehicle.assignedTo.name);

      if (ctx.dryRun) {
        detail.push(
          `→ ${label}: service ${days < 0 ? `${-days}d overdue` : `due in ${days}d`} — WOULD notify ${Array.from(recipients.values()).join(", ")}`
        );
        notified += 1;
        continue;
      }

      let delivered = 0;
      for (const [recipientId, recipientName] of Array.from(recipients.entries())) {
        try {
          await notify({
            recipientId,
            type: "vehicle-maintenance-due",
            title,
            body,
            href: `/fleet/${vehicle.id}`,
            entityType: "vehicle",
            entityId: vehicle.id,
            email: {
              templateKey: "notification",
              data: {
                recipientName,
                heading: title,
                body: `${label} has service scheduled for ${serviceDay}. Log the maintenance in OpsHub once it's done to reset the schedule.`,
                cta: { label: "Open vehicle", url: absoluteUrl(`/fleet/${vehicle.id}`) },
              },
            },
          });
          delivered += 1;
        } catch (err) {
          log.error("jobs.vehicleMaintenance", "Notify failed", err, {
            vehicleId: vehicle.id,
            recipientId,
          });
        }
      }

      if (delivered > 0) {
        notified += 1;
        detail.push(
          `→ ${label}: service ${days < 0 ? `${-days}d overdue` : `due in ${days}d`} — notified ${Array.from(recipients.values()).join(", ")}`
        );
        await db.vehicle.update({
          where: { id: vehicle.id },
          data: { maintenanceNotifiedFor: vehicle.nextServiceDate },
        });
      }
    }

    return {
      output: [
        `Checked ${vehicles.length} vehicle${vehicles.length === 1 ? "" : "s"} in the service window, ${ctx.dryRun ? "would notify" : "notified"} on ${notified}.`,
        ...(detail.length > 0 ? ["", ...detail] : []),
      ].join("\n"),
      processed: notified,
    };
  },
};
