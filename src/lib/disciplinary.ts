import type { DisciplinaryActionType, Role } from "@prisma/client";

/**
 * Roles allowed to see or manage disciplinary reports. Everything HR —
 * the profile tab, the actions, the PDF route, and the activity-log
 * visibility filter — gates on this one predicate.
 */
export function isHrRole(role: Role): boolean {
  return role === "ADMIN" || role === "MANAGER";
}

/** Ordered form options + display labels for disciplinary action types. */
export const DISCIPLINARY_ACTION_TYPES: DisciplinaryActionType[] = [
  "VERBAL_WARNING",
  "WRITTEN_WARNING",
  "FINAL_WARNING",
  "SUSPENSION",
  "TERMINATION",
  "OTHER",
];

export const DISCIPLINARY_ACTION_LABELS: Record<DisciplinaryActionType, string> = {
  VERBAL_WARNING: "Verbal warning",
  WRITTEN_WARNING: "Written warning",
  FINAL_WARNING: "Final written warning",
  SUSPENSION: "Suspension",
  TERMINATION: "Termination",
  OTHER: "Other",
};
