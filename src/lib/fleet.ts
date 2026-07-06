import { differenceInDays } from "date-fns";

/** Days-to-service window that counts as "due soon". */
export const MAINTENANCE_DUE_WINDOW_DAYS = 14;

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

/** Date-derived service state — same philosophy as lib/effective-status. */
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
