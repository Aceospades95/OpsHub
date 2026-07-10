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
 */
export type NotificationType =
  | "task-assigned"
  | "task-completed"
  | "task-due-soon"
  | "mention"
  | "assignment-created"
  | "assignment-removed"
  | "project-updated"
  | "comment-added"
  | "milestone-assigned"
  | "certification-expiring"
  | "vehicle-maintenance-due"
  | "bid-due-soon"
  | "system"
  | "test";

/** Human-readable labels for notification types — used in the UI. */
export const NOTIFICATION_TYPE_LABELS: Record<NotificationType, string> = {
  "task-assigned": "Task assigned",
  "task-completed": "Task completed",
  "task-due-soon": "Task due soon",
  mention: "Mention",
  "assignment-created": "New assignment",
  "assignment-removed": "Assignment removed",
  "project-updated": "Project updated",
  "comment-added": "New comment",
  "milestone-assigned": "Milestone assignment",
  "certification-expiring": "Certification expiring",
  "vehicle-maintenance-due": "Vehicle maintenance due",
  "bid-due-soon": "Bid deadline approaching",
  system: "System",
  test: "Test",
};
