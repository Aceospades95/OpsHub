import type { DisciplinaryActionType } from "@prisma/client";

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
