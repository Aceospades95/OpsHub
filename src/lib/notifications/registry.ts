/**
 * Notification type registry — one entry per NotificationType, with the
 * human context the admin Rules tab needs: what fires it, who hears
 * about it by default, and which {{variables}} its rule templates can
 * substitute. No side effects; safe for client components.
 *
 * The engine (index.ts) exposes the SAME variable set for every type:
 *   {{recipientName}} — the addressee's display name
 *   {{title}}         — the in-app notification title
 *   {{body}}          — the in-app notification body
 *   {{heading}}       — the email heading (defaults to the code's)
 *   {{emailBody}}     — the email body text (defaults to the code's)
 *   {{href}}          — the in-app click target (relative URL)
 */

import type { NotificationType } from "./types";
import { NOTIFICATION_TYPE_LABELS } from "./types";

export interface NotificationTypeInfo {
  key: NotificationType;
  label: string;
  /** What causes this notification, in plain words. */
  trigger: string;
  /** Who receives it when no rule adds anyone. */
  defaultRecipients: string;
  /** True when the code path can send an email (has an email block). */
  emailsByDefault: boolean;
}

export const TEMPLATE_VARIABLES = [
  "recipientName",
  "title",
  "body",
  "heading",
  "emailBody",
  "href",
] as const;

export const NOTIFICATION_TYPE_REGISTRY: NotificationTypeInfo[] = [
  {
    key: "task-assigned",
    label: NOTIFICATION_TYPE_LABELS["task-assigned"],
    trigger: "A task is assigned or reassigned to someone",
    defaultRecipients: "The new assignee",
    emailsByDefault: true,
  },
  {
    key: "mention",
    label: NOTIFICATION_TYPE_LABELS.mention,
    trigger: "Someone @mentions a user in a comment",
    defaultRecipients: "The mentioned users (active, with login access)",
    emailsByDefault: true,
  },
  {
    key: "assignment-created",
    label: NOTIFICATION_TYPE_LABELS["assignment-created"],
    trigger: "An employee is staffed onto a project",
    defaultRecipients: "The staffed employee",
    emailsByDefault: true,
  },
  {
    key: "assignment-removed",
    label: NOTIFICATION_TYPE_LABELS["assignment-removed"],
    trigger: "An employee's project assignment is removed",
    defaultRecipients: "The affected employee",
    emailsByDefault: false,
  },
  {
    key: "project-updated",
    label: NOTIFICATION_TYPE_LABELS["project-updated"],
    trigger: "A user is added as a project member",
    defaultRecipients: "The added member",
    emailsByDefault: false,
  },
  {
    key: "milestone-assigned",
    label: NOTIFICATION_TYPE_LABELS["milestone-assigned"],
    trigger: "A user is added as a milestone assignee",
    defaultRecipients: "The added assignee",
    emailsByDefault: false,
  },
  {
    key: "certification-expiring",
    label: NOTIFICATION_TYPE_LABELS["certification-expiring"],
    trigger:
      "The daily certification check: a cert crosses one of its reminder offsets (e.g. 90/30/7 days before expiry)",
    defaultRecipients: "The certification's assignee and point of contact",
    emailsByDefault: true,
  },
  {
    key: "vehicle-maintenance-due",
    label: NOTIFICATION_TYPE_LABELS["vehicle-maintenance-due"],
    trigger:
      "The daily fleet check: a service schedule or the vehicle's next-service date is due soon or overdue",
    defaultRecipients: "Active admins + managers, plus the assigned driver",
    emailsByDefault: true,
  },
  {
    key: "vehicle-maintenance-overdue",
    label: NOTIFICATION_TYPE_LABELS["vehicle-maintenance-overdue"],
    trigger:
      "The daily fleet check: service overdue past the escalation threshold (job settings control the days)",
    defaultRecipients: "The driver's manager (add management here for the CC list)",
    emailsByDefault: true,
  },
  {
    key: "vehicle-maintenance-logged",
    label: NOTIFICATION_TYPE_LABELS["vehicle-maintenance-logged"],
    trigger: "A driver logs completed maintenance from the vehicle page",
    defaultRecipients: "Active admins + managers (in-app only)",
    emailsByDefault: false,
  },
  {
    key: "bid-due-soon",
    label: NOTIFICATION_TYPE_LABELS["bid-due-soon"],
    trigger:
      "The daily bid check: an open bid's response deadline is inside the due-soon window or overdue",
    defaultRecipients: "Active admins + managers, plus the bid owner",
    emailsByDefault: true,
  },
  {
    key: "job-failing",
    label: NOTIFICATION_TYPE_LABELS["job-failing"],
    trigger: "A scheduled job fails 3 runs in a row",
    defaultRecipients: "Active admins",
    emailsByDefault: true,
  },
  {
    key: "system",
    label: NOTIFICATION_TYPE_LABELS.system,
    trigger:
      "System events: access requests + approvals/denials, contract expiry warnings",
    defaultRecipients: "Admins (access requests) or the requester / account manager",
    emailsByDefault: true,
  },
  {
    key: "test",
    label: NOTIFICATION_TYPE_LABELS.test,
    trigger: "The admin “send test notification” button",
    defaultRecipients: "Whoever clicked it",
    emailsByDefault: true,
  },
];

export const NOTIFICATION_TYPE_INFO = new Map(
  NOTIFICATION_TYPE_REGISTRY.map((t) => [t.key, t])
);
