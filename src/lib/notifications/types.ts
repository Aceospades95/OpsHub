/**
 * Shared types for the notification infrastructure.
 *
 * Kept in a separate file with no side effects so templates and UI code
 * can import without pulling in the database client.
 */

/**
 * Well-known notification types. Stored as a string on the row so new
 * types can be added without a migration — but we still enum them here
 * to get TypeScript checking at call sites.
 *
 * Every type here must have a NOTIFICATION_TYPE_REGISTRY entry
 * (./registry.ts) describing its trigger, default recipients, and
 * template variables — that registry drives the admin Rules tab.
 * (The former task-completed / task-due-soon / comment-added types were
 * declared for years but never emitted anywhere; removed rather than
 * advertise rules for events that can't happen.)
 */
export type NotificationType =
  | "task-assigned"
  | "mention"
  | "assignment-created"
  | "assignment-removed"
  | "project-updated"
  | "milestone-assigned"
  | "certification-expiring"
  | "vehicle-maintenance-due"
  | "vehicle-maintenance-overdue"
  | "vehicle-maintenance-logged"
  | "bid-due-soon"
  | "job-failing"
  | "system"
  | "test";

/** Human-readable labels for notification types — used in the UI. */
export const NOTIFICATION_TYPE_LABELS: Record<NotificationType, string> = {
  "task-assigned": "Task assigned",
  mention: "Mention",
  "assignment-created": "New assignment",
  "assignment-removed": "Assignment removed",
  "project-updated": "Project updated",
  "milestone-assigned": "Milestone assignment",
  "certification-expiring": "Certification expiring",
  "vehicle-maintenance-due": "Vehicle maintenance due",
  "vehicle-maintenance-overdue": "Vehicle maintenance overdue (escalation)",
  "vehicle-maintenance-logged": "Vehicle maintenance logged",
  "bid-due-soon": "Bid deadline approaching",
  "job-failing": "Scheduled job failing",
  system: "System",
  test: "Test",
};
