/**
 * Pure (db-free) constants for the contact interaction log: the closed
 * kind set, display labels, and field caps — shared by the server
 * actions (src/actions/interactions.ts) and the interactions card UI.
 *
 * They live here rather than in the actions file because a "use server"
 * module may only export async functions (next-flight-loader's
 * action-validate throws on any other export), and the UI needs these
 * synchronously at render — same split as lib/contact-types.ts vs
 * src/actions/contacts.ts.
 */

/**
 * The closed set of interaction kinds. Stored as a plain string column
 * and enforced in the action layer — same convention as
 * ContactLink.entityType (keeps enum churn out of the DB).
 */
export const INTERACTION_KINDS = ["CALL", "EMAIL", "MEETING", "NOTE", "OTHER"] as const;

export type InteractionKind = (typeof INTERACTION_KINDS)[number];

/** Display labels ("Call", "Email", …) — used in badges, selects, and activity rows. */
export const INTERACTION_KIND_LABELS: Record<InteractionKind, string> = {
  CALL: "Call",
  EMAIL: "Email",
  MEETING: "Meeting",
  NOTE: "Note",
  OTHER: "Other",
};

export function isInteractionKind(value: string): value is InteractionKind {
  return (INTERACTION_KINDS as readonly string[]).includes(value);
}

/** Field caps enforced by the actions (and mirrored in the form UI). */
export const MAX_INTERACTION_SUMMARY_LENGTH = 200;
export const MAX_INTERACTION_NOTES_LENGTH = 5000;
