import { addMonths, differenceInDays } from "date-fns";

/** Days-to-service window that counts as "due soon". */
export const MAINTENANCE_DUE_WINDOW_DAYS = 14;

/** Miles-remaining window that counts as "due soon" for mileage bounds. */
export const MAINTENANCE_DUE_SOON_MILES = 500;

/** Days-to-expiry window for registration/plates renewal. */
export const REGISTRATION_DUE_WINDOW_DAYS = 30;

/** Display label: nickname when set, else "2022 Ford Transit". */
export function vehicleLabel(vehicle: {
  nickname: string | null;
  year: number;
  make: string;
  model: string;
}): string {
  return vehicle.nickname?.trim() || `${vehicle.year} ${vehicle.make} ${vehicle.model}`;
}

export type MaintenanceDueState = "overdue" | "due-soon" | "scheduled" | "none";

/**
 * Date-derived service state for the LEGACY single next-service date on
 * the vehicle row — same philosophy as lib/effective-status. Vehicles
 * with per-service-type schedules use scheduleDueState /
 * vehicleScheduleSummary below instead.
 */
export function maintenanceDueState(
  vehicle: { nextServiceDate: Date | null; status: string },
  now: Date
): MaintenanceDueState {
  // Retired/sold vehicles never nag.
  if (vehicle.status === "RETIRED" || vehicle.status === "SOLD") return "none";
  if (!vehicle.nextServiceDate) return "none";
  const days = differenceInDays(vehicle.nextServiceDate, now);
  if (days < 0) return "overdue";
  if (days <= MAINTENANCE_DUE_WINDOW_DAYS) return "due-soon";
  return "scheduled";
}

// ─── Per-service-type schedules ───────────────────────────────────
//
// The spreadsheet model this module replaces: each vehicle carries one
// row per service type ("Oil Change — every 3 months / 4,000 miles —
// last done 2026-03-02 @ 41,200 mi"). Due is whichever bound trips
// first: time since the last service vs everyMonths, OR miles since
// the last service (vehicle.currentMileage - lastServiceMileage) vs
// everyMiles. Either bound may be absent for time-only / miles-only
// schedules.

export type ScheduleDueStatus = "ok" | "due-soon" | "overdue" | "unknown";

/** The VehicleServiceSchedule fields the due math needs. */
export interface ScheduleDueInput {
  everyMonths: number | null;
  everyMiles: number | null;
  lastServiceDate: Date | null;
  lastServiceMileage: number | null;
}

export interface ScheduleDueState {
  /** lastServiceDate + everyMonths, when both are set. */
  dueDate: Date | null;
  /** lastServiceMileage + everyMiles, when both are set. */
  dueMileage: number | null;
  /** dueMileage - vehicle.currentMileage; negative once past due. */
  milesRemaining: number | null;
  /** Whole days until dueDate; negative once past due. */
  daysRemaining: number | null;
  status: ScheduleDueStatus;
}

export interface DueWindowOptions {
  /** Days-out that counts as due-soon. Default 14. */
  dueSoonDays?: number;
  /** Miles-remaining that counts as due-soon. Default 500. */
  dueSoonMiles?: number;
}

/**
 * Compute the due state for one service schedule.
 *
 *   - overdue:  dueDate is in the past, OR the vehicle's odometer has
 *               reached dueMileage.
 *   - due-soon: dueDate within `dueSoonDays`, OR fewer than
 *               `dueSoonMiles` miles remain.
 *   - unknown:  neither bound is assessable — the schedule has no
 *               last-service baseline for its cadence (or a mileage
 *               bound exists but the vehicle has no odometer reading).
 *   - ok:       everything else.
 */
export function scheduleDueState(
  schedule: ScheduleDueInput,
  vehicle: { currentMileage: number | null },
  now: Date,
  opts: DueWindowOptions = {}
): ScheduleDueState {
  const dueSoonDays = opts.dueSoonDays ?? MAINTENANCE_DUE_WINDOW_DAYS;
  const dueSoonMiles = opts.dueSoonMiles ?? MAINTENANCE_DUE_SOON_MILES;

  const dueDate =
    schedule.lastServiceDate != null && schedule.everyMonths != null
      ? addMonths(schedule.lastServiceDate, schedule.everyMonths)
      : null;
  const dueMileage =
    schedule.lastServiceMileage != null && schedule.everyMiles != null
      ? schedule.lastServiceMileage + schedule.everyMiles
      : null;

  const daysRemaining = dueDate ? differenceInDays(dueDate, now) : null;
  const milesRemaining =
    dueMileage != null && vehicle.currentMileage != null
      ? dueMileage - vehicle.currentMileage
      : null;

  const dateAssessable = dueDate != null;
  const milesAssessable = milesRemaining != null;

  let status: ScheduleDueStatus;
  if (!dateAssessable && !milesAssessable) {
    status = "unknown";
  } else if (
    (dueDate != null && dueDate.getTime() < now.getTime()) ||
    (milesRemaining != null && milesRemaining <= 0)
  ) {
    status = "overdue";
  } else if (
    (daysRemaining != null && daysRemaining <= dueSoonDays) ||
    (milesRemaining != null && milesRemaining <= dueSoonMiles)
  ) {
    status = "due-soon";
  } else {
    status = "ok";
  }

  return { dueDate, dueMileage, milesRemaining, daysRemaining, status };
}

export type VehicleScheduleStatus = ScheduleDueStatus | "none";

export interface VehicleScheduleSummary {
  /**
   * Worst status across the vehicle's schedules. Severity order:
   * overdue > due-soon > unknown > ok — "unknown" outranks "ok" so a
   * schedule that can never fire (no baseline yet) surfaces as a data
   * problem instead of silently reading healthy. "none" when the
   * vehicle has no schedules (or is retired/sold).
   */
  status: VehicleScheduleStatus;
  overdueCount: number;
  dueSoonCount: number;
  unknownCount: number;
  /**
   * The most urgent assessable schedule (overdue first, then earliest
   * due date, then fewest miles remaining) — drives "Oil Change due
   * Jun 3" list badges. Null when nothing is assessable.
   */
  nextDue: { serviceType: string; state: ScheduleDueState } | null;
}

const STATUS_SEVERITY: Record<ScheduleDueStatus, number> = {
  overdue: 4,
  "due-soon": 3,
  unknown: 2,
  ok: 1,
};

/**
 * Roll a vehicle's schedules up to one badge-able status + the next
 * due item. Retired/sold vehicles never nag (mirrors
 * maintenanceDueState).
 */
export function vehicleScheduleSummary(
  schedules: Array<ScheduleDueInput & { serviceType: string }>,
  vehicle: { currentMileage: number | null; status?: string },
  now: Date,
  opts: DueWindowOptions = {}
): VehicleScheduleSummary {
  const empty: VehicleScheduleSummary = {
    status: "none",
    overdueCount: 0,
    dueSoonCount: 0,
    unknownCount: 0,
    nextDue: null,
  };
  if (vehicle.status === "RETIRED" || vehicle.status === "SOLD") return empty;
  if (schedules.length === 0) return empty;

  const items = schedules.map((schedule) => ({
    serviceType: schedule.serviceType,
    state: scheduleDueState(schedule, vehicle, now, opts),
  }));

  let worst: ScheduleDueStatus = "ok";
  let overdueCount = 0;
  let dueSoonCount = 0;
  let unknownCount = 0;
  for (const item of items) {
    if (item.state.status === "overdue") overdueCount += 1;
    if (item.state.status === "due-soon") dueSoonCount += 1;
    if (item.state.status === "unknown") unknownCount += 1;
    if (STATUS_SEVERITY[item.state.status] > STATUS_SEVERITY[worst]) {
      worst = item.state.status;
    }
  }

  // Next due: most urgent assessable item. Unknown rows have nothing
  // to sort by (no computable bound), so they're excluded here — they
  // still surface via unknownCount / worst status.
  const assessable = items.filter((i) => i.state.status !== "unknown");
  assessable.sort((a, b) => {
    const severity = STATUS_SEVERITY[b.state.status] - STATUS_SEVERITY[a.state.status];
    if (severity !== 0) return severity;
    const aDate = a.state.dueDate?.getTime() ?? Infinity;
    const bDate = b.state.dueDate?.getTime() ?? Infinity;
    if (aDate !== bDate) return aDate - bDate;
    const aMiles = a.state.milesRemaining ?? Infinity;
    const bMiles = b.state.milesRemaining ?? Infinity;
    return aMiles - bMiles;
  });

  return {
    status: worst,
    overdueCount,
    dueSoonCount,
    unknownCount,
    nextDue: assessable[0] ?? null,
  };
}

// ─── Registration / plates expiry ─────────────────────────────────

export type RegistrationDueStatus = "ok" | "due-soon" | "overdue" | "none";

/**
 * Registration expiry, treated like a time-only schedule with a 30-day
 * due-soon window. "none" when no expiry is recorded or the vehicle is
 * retired/sold.
 */
export function registrationDueState(
  vehicle: { registrationExpiresAt: Date | null; status?: string },
  now: Date,
  windowDays: number = REGISTRATION_DUE_WINDOW_DAYS
): { status: RegistrationDueStatus; daysRemaining: number | null } {
  if (vehicle.status === "RETIRED" || vehicle.status === "SOLD") {
    return { status: "none", daysRemaining: null };
  }
  if (!vehicle.registrationExpiresAt) return { status: "none", daysRemaining: null };
  const daysRemaining = differenceInDays(vehicle.registrationExpiresAt, now);
  if (vehicle.registrationExpiresAt.getTime() < now.getTime()) {
    return { status: "overdue", daysRemaining };
  }
  if (daysRemaining <= windowDays) return { status: "due-soon", daysRemaining };
  return { status: "ok", daysRemaining };
}

/** "every 3 mo / 4,000 mi" — cadence label for schedule tables. */
export function scheduleCadenceLabel(schedule: {
  everyMonths: number | null;
  everyMiles: number | null;
}): string {
  const parts: string[] = [];
  if (schedule.everyMonths != null) parts.push(`${schedule.everyMonths} mo`);
  if (schedule.everyMiles != null) parts.push(`${schedule.everyMiles.toLocaleString()} mi`);
  return parts.length > 0 ? `every ${parts.join(" / ")}` : "—";
}
