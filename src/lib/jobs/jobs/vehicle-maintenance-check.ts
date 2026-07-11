/**
 * vehicle-maintenance-check (v2)
 *
 * Evaluates THREE things for every ACTIVE / IN_SHOP vehicle, daily:
 *
 *  1. Per-service-type schedules (VehicleServiceSchedule): due when
 *     either bound trips first — time since last service vs everyMonths,
 *     or miles since last service vs everyMiles (see lib/fleet
 *     scheduleDueState). Deduped via schedule.notifiedForDueAt — one
 *     notification per computed due date (or one per mileage-only
 *     trigger, stamped with the send time); logging the service clears
 *     the stamp and re-arms it.
 *  2. The LEGACY single Vehicle.nextServiceDate — unchanged semantics,
 *     applied only to vehicles with NO schedules. Deduped via
 *     Vehicle.maintenanceNotifiedFor exactly as before.
 *  3. Registration expiry (Vehicle.registrationExpiresAt) within 30
 *     days or past.
 *
 * Recipients: active admins + managers, plus the assigned driver.
 * Escalations additionally notify the assigned driver's manager
 * (User.managerId) with type "vehicle-maintenance-overdue" once a
 * schedule is overdue past the configured thresholds; the notification
 * rule layer adds management recipients for that type centrally.
 *
 * ESCALATION CADENCE — escalations are deliberately NOT deduped by
 * notifiedForDueAt (they must repeat while the problem persists) but
 * must not spam daily either. The job runs daily, so we re-send only
 * when (overdueDays - threshold) % 7 === 0 with overdueDays >=
 * threshold: exactly on the day each threshold is crossed and weekly
 * thereafter. Comparing "yesterday vs today" (overdueDays === threshold
 * + 1 style) breaks whenever a day is missed; the weekly modulo
 * self-heals at the next multiple.
 *
 * REGISTRATION CADENCE — same weekly-modulo idea keyed on days
 * remaining: reminders fire at 30, 14, 7, and 1 day(s) before expiry,
 * then on expiry day and weekly after while expired. No dedupe stamp is
 * needed because the checkpoints themselves gate repeat sends.
 */

import { db } from "@/lib/db";
import { log } from "@/lib/log";
import { notify, type NotificationType } from "@/lib/notifications";
import { absoluteUrl } from "@/lib/url";
import { differenceInDays } from "date-fns";
import { formatCalendarDate } from "@/lib/dates";
import { vehicleLabel, scheduleDueState, registrationDueState } from "@/lib/fleet";
import { getJobParams } from "../index";
import { shouldRunDaily } from "../gating";
import type { JobDefinition } from "../types";

/**
 * Registered centrally in the notification-type registry (landing with
 * the concurrent notification-rules work — that layer also adds the
 * management recipients on the second escalation). The cast keeps this
 * module compiling against the current union either way.
 */
const OVERDUE_TYPE = "vehicle-maintenance-overdue" as string as NotificationType;

const PARAM_DEFAULTS = {
  dueSoonDays: 14,
  dueSoonMiles: 500,
  escalateManagerAfterDays: 7,
  escalateManagementAfterDays: 21,
};

/** See ESCALATION CADENCE in the header comment. */
function shouldEscalate(overdueDays: number, thresholdDays: number): boolean {
  return overdueDays >= thresholdDays && (overdueDays - thresholdDays) % 7 === 0;
}

/** See REGISTRATION CADENCE in the header comment. */
function isRegistrationCheckpoint(daysRemaining: number): boolean {
  if (daysRemaining > 0) return [30, 14, 7, 1].includes(daysRemaining);
  return -daysRemaining % 7 === 0;
}

/** "due in 5d" / "12d overdue" / "300 mi remaining" / "800 mi past due". */
function describeDue(state: {
  daysRemaining: number | null;
  milesRemaining: number | null;
}): string {
  const parts: string[] = [];
  if (state.daysRemaining != null) {
    parts.push(
      state.daysRemaining < 0 ? `${-state.daysRemaining}d overdue` : `due in ${state.daysRemaining}d`
    );
  }
  if (state.milesRemaining != null) {
    parts.push(
      state.milesRemaining <= 0
        ? `${-state.milesRemaining} mi past due`
        : `${state.milesRemaining.toLocaleString()} mi remaining`
    );
  }
  return parts.join(", ") || "due";
}

interface Recipient {
  id: string;
  name: string;
}

export const vehicleMaintenanceCheck: JobDefinition = {
  key: "vehicle-maintenance-check",
  name: "Vehicle maintenance check",
  description:
    "Notifies admins/managers and the assigned driver when a vehicle's service schedule or registration is due soon or overdue, and escalates persistent overdue services to the driver's manager",
  schedule: "Daily",
  supportsDryRun: true,
  paramsSchema: [
    {
      key: "dueSoonDays",
      label: "Due-soon window (days)",
      type: "number",
      help: "Notify when service is due within this many days",
    },
    { key: "dueSoonMiles", label: "Due-soon window (miles)", type: "number" },
    {
      key: "escalateManagerAfterDays",
      label: "Escalate to manager after (days overdue)",
      type: "number",
    },
    {
      key: "escalateManagementAfterDays",
      label: "Escalate to management after (days overdue)",
      type: "number",
    },
  ],

  async handler(ctx) {
    // Dry runs always evaluate — the point of a preview is to see what
    // the next real run would do, even right after one completed.
    if (!ctx.dryRun && !(await shouldRunDaily("vehicle-maintenance-check"))) {
      return { status: "skipped", output: "Already ran today", processed: 0 };
    }
    const params = await getJobParams("vehicle-maintenance-check", PARAM_DEFAULTS);
    const now = new Date();
    const dueWindow = { dueSoonDays: params.dueSoonDays, dueSoonMiles: params.dueSoonMiles };

    const [vehicles, office] = await Promise.all([
      db.vehicle.findMany({
        where: { deletedAt: null, status: { in: ["ACTIVE", "IN_SHOP"] } },
        include: {
          serviceSchedules: { orderBy: { serviceType: "asc" } },
          assignedTo: { select: { id: true, name: true, managerId: true } },
        },
      }),
      db.user.findMany({
        where: { isActive: true, role: { in: ["ADMIN", "MANAGER"] } },
        select: { id: true, name: true },
      }),
    ]);

    // Resolve the drivers' managers (for escalations) in one query.
    const managerIds = Array.from(
      new Set(
        vehicles
          .map((v) => v.assignedTo?.managerId)
          .filter((id): id is string => id != null)
      )
    );
    const managerRows =
      managerIds.length > 0
        ? await db.user.findMany({
            where: { id: { in: managerIds }, isActive: true },
            select: { id: true, name: true },
          })
        : [];
    const managerById = new Map(managerRows.map((m) => [m.id, m]));

    let dueNotices = 0;
    let escalations = 0;
    let registrationNotices = 0;
    const detail: string[] = [];

    /** One notify() per recipient (the certification pattern) so each
     *  email greets the person by name. Returns delivered count. */
    async function deliver(
      recipients: Recipient[],
      payload: {
        type: NotificationType;
        title: string;
        body: string;
        vehicleId: string;
        emailBody: string;
      }
    ): Promise<number> {
      let delivered = 0;
      for (const recipient of recipients) {
        try {
          await notify({
            recipientId: recipient.id,
            type: payload.type,
            title: payload.title,
            body: payload.body,
            href: `/fleet/${payload.vehicleId}`,
            entityType: "vehicle",
            entityId: payload.vehicleId,
            email: {
              templateKey: "notification",
              data: {
                recipientName: recipient.name,
                heading: payload.title,
                body: payload.emailBody,
                cta: { label: "Open vehicle", url: absoluteUrl(`/fleet/${payload.vehicleId}`) },
              },
            },
          });
          delivered += 1;
        } catch (err) {
          log.error("jobs.vehicleMaintenance", "Notify failed", err, {
            vehicleId: payload.vehicleId,
            recipientId: recipient.id,
          });
        }
      }
      return delivered;
    }

    for (const vehicle of vehicles) {
      const label = vehicleLabel(vehicle);
      const plateSuffix = vehicle.licensePlate ? ` · ${vehicle.licensePlate}` : "";

      // Admins/managers + the assigned driver. Drivers can open the
      // link — vehicle assignment grants scoped view of the vehicle.
      const recipientMap = new Map<string, Recipient>(office.map((m) => [m.id, m]));
      if (vehicle.assignedTo) {
        recipientMap.set(vehicle.assignedTo.id, {
          id: vehicle.assignedTo.id,
          name: vehicle.assignedTo.name,
        });
      }
      const recipients = Array.from(recipientMap.values());
      const recipientNames = recipients.map((r) => r.name).join(", ");

      // ── 1. Per-service-type schedules ────────────────────────────
      for (const schedule of vehicle.serviceSchedules) {
        const state = scheduleDueState(schedule, vehicle, now, dueWindow);
        if (state.status !== "due-soon" && state.status !== "overdue") continue;

        const itemLabel = `${label}: ${schedule.serviceType} ${describeDue(state)}`;

        // Dedupe: one notification per computed due date. Mileage-only
        // triggers have no due date — stamp the send time instead and
        // stay quiet until a logged service clears the stamp.
        const alreadyNotified =
          state.dueDate != null
            ? schedule.notifiedForDueAt?.getTime() === state.dueDate.getTime()
            : schedule.notifiedForDueAt != null;

        if (alreadyNotified) {
          detail.push(`· ${itemLabel} — already notified (logging service re-arms it)`);
        } else if (ctx.dryRun) {
          detail.push(`→ ${itemLabel} — WOULD notify ${recipientNames}`);
          dueNotices += 1;
        } else {
          const title =
            state.status === "overdue"
              ? `${schedule.serviceType} overdue: ${label}`
              : `${schedule.serviceType} due soon: ${label}`;
          const delivered = await deliver(recipients, {
            type: "vehicle-maintenance-due",
            title,
            body: `${label}${plateSuffix} · ${schedule.serviceType} ${describeDue(state)}`,
            vehicleId: vehicle.id,
            emailBody: `${schedule.serviceType} for ${label} is ${describeDue(state)}. Log the maintenance in OpsHub once it's done to reset the schedule.`,
          });
          if (delivered > 0) {
            dueNotices += 1;
            detail.push(`→ ${itemLabel} — notified ${recipientNames}`);
            await db.vehicleServiceSchedule.update({
              where: { id: schedule.id },
              data: { notifiedForDueAt: state.dueDate ?? now },
            });
          }
        }

        // Escalation — day-based, so it needs a due DATE; mileage-only
        // overdue items can't measure "days overdue" and never escalate.
        if (state.status === "overdue" && state.dueDate != null) {
          const overdueDays = differenceInDays(now, state.dueDate);
          const second = shouldEscalate(overdueDays, params.escalateManagementAfterDays);
          const first = shouldEscalate(overdueDays, params.escalateManagerAfterDays);
          if (!first && !second) continue;

          const driver = vehicle.assignedTo;
          const manager = driver?.managerId ? managerById.get(driver.managerId) : undefined;
          if (!driver) {
            detail.push(`· ${itemLabel} — escalation due but no assigned driver; skipped`);
            continue;
          }
          if (!manager) {
            detail.push(
              `· ${itemLabel} — escalation due but ${driver.name} has no manager; skipped`
            );
            continue;
          }

          const escalationTag = second ? " (second escalation)" : "";
          if (ctx.dryRun) {
            detail.push(
              `→ ${itemLabel} — WOULD escalate${escalationTag} to ${manager.name} (${overdueDays}d overdue)`
            );
            escalations += 1;
            continue;
          }
          const delivered = await deliver([manager], {
            type: OVERDUE_TYPE,
            title: `Escalation${escalationTag}: ${schedule.serviceType} ${overdueDays}d overdue — ${label}`,
            body: `${label}${plateSuffix} · driver ${driver.name} · ${schedule.serviceType} ${describeDue(state)}${escalationTag}`,
            vehicleId: vehicle.id,
            emailBody: `${schedule.serviceType} for ${label} (driver: ${driver.name}) has been overdue for ${overdueDays} days${escalationTag}. Please make sure the service gets scheduled.`,
          });
          if (delivered > 0) {
            escalations += 1;
            detail.push(
              `→ ${itemLabel} — escalated${escalationTag} to ${manager.name} (${overdueDays}d overdue)`
            );
          }
        }
      }

      // ── 2. Legacy single next-service date (no schedules only) ───
      if (vehicle.serviceSchedules.length === 0 && vehicle.nextServiceDate) {
        const days = differenceInDays(vehicle.nextServiceDate, now);
        if (days <= params.dueSoonDays) {
          const dueText = days < 0 ? `${-days}d overdue` : `due in ${days}d`;
          if (
            vehicle.maintenanceNotifiedFor &&
            vehicle.maintenanceNotifiedFor.getTime() === vehicle.nextServiceDate.getTime()
          ) {
            detail.push(
              `· ${label}: service ${dueText} — already notified for this date (logging service re-arms it)`
            );
          } else if (ctx.dryRun) {
            detail.push(`→ ${label}: service ${dueText} — WOULD notify ${recipientNames}`);
            dueNotices += 1;
          } else {
            const title =
              days < 0
                ? `Vehicle maintenance overdue: ${label}`
                : `Vehicle maintenance due in ${days} day${days === 1 ? "" : "s"}: ${label}`;
            // Calendar date — server-local toDateString() would name
            // the previous day on hosts west of UTC.
            const serviceDay = formatCalendarDate(vehicle.nextServiceDate, "MMMM d, yyyy");
            const delivered = await deliver(recipients, {
              type: "vehicle-maintenance-due",
              title,
              body: vehicle.licensePlate ? `${label}${plateSuffix}` : label,
              vehicleId: vehicle.id,
              emailBody: `${label} has service scheduled for ${serviceDay}. Log the maintenance in OpsHub once it's done to reset the schedule.`,
            });
            if (delivered > 0) {
              dueNotices += 1;
              detail.push(`→ ${label}: service ${dueText} — notified ${recipientNames}`);
              await db.vehicle.update({
                where: { id: vehicle.id },
                data: { maintenanceNotifiedFor: vehicle.nextServiceDate },
              });
            }
          }
        }
      }

      // ── 3. Registration expiry ───────────────────────────────────
      const registration = registrationDueState(vehicle, now);
      if (registration.status === "due-soon" || registration.status === "overdue") {
        const daysRemaining = registration.daysRemaining ?? 0;
        const regText =
          daysRemaining < 0
            ? `expired ${-daysRemaining}d ago`
            : daysRemaining === 0
              ? "expires today"
              : `expires in ${daysRemaining}d`;
        if (!isRegistrationCheckpoint(daysRemaining)) {
          detail.push(
            `· ${label}: registration ${regText} — waiting for the next checkpoint (30/14/7/1d out, then weekly past due)`
          );
        } else if (ctx.dryRun) {
          detail.push(`→ ${label}: registration ${regText} — WOULD notify ${recipientNames}`);
          registrationNotices += 1;
        } else {
          const expiryDay = formatCalendarDate(vehicle.registrationExpiresAt, "MMMM d, yyyy");
          const delivered = await deliver(recipients, {
            type: "vehicle-maintenance-due",
            title: `Registration ${regText}: ${label}`,
            body: `${label}${plateSuffix} · registration ${regText} (${expiryDay})`,
            vehicleId: vehicle.id,
            emailBody: `The registration for ${label} ${daysRemaining < 0 ? "expired" : "expires"} on ${expiryDay}. Renew it and update the expiry date in OpsHub.`,
          });
          if (delivered > 0) {
            registrationNotices += 1;
            detail.push(`→ ${label}: registration ${regText} — notified ${recipientNames}`);
          }
        }
      }
    }

    const totalScheduleRows = vehicles.reduce((sum, v) => sum + v.serviceSchedules.length, 0);
    const verb = ctx.dryRun ? "would send" : "sent";
    const summary = [
      `Checked ${vehicles.length} active vehicle${vehicles.length === 1 ? "" : "s"} (${totalScheduleRows} service schedule${totalScheduleRows === 1 ? "" : "s"}): ${verb} ${dueNotices} due notice${dueNotices === 1 ? "" : "s"}, ${escalations} escalation${escalations === 1 ? "" : "s"}, ${registrationNotices} registration notice${registrationNotices === 1 ? "" : "s"}.`,
      `Cadence: due notices once per computed due date (re-armed by logging service); escalations at ${params.escalateManagerAfterDays}d overdue to the driver's manager and ${params.escalateManagementAfterDays}d to management, repeating weekly; registration reminders at 30/14/7/1 days out, then weekly once expired.`,
      ...(detail.length > 0 ? ["", ...detail] : []),
    ].join("\n");

    return { output: summary, processed: dueNotices + escalations + registrationNotices };
  },
};
