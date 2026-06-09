/**
 * Notification infrastructure — public API.
 *
 * One entry point (`notify`) that other features call when something
 * happens a user should know about. Writes an in-app Notification row
 * and, optionally, fires a matching email through the email layer from
 * session 5.
 *
 * Example:
 *
 *   import { notify } from "@/lib/notifications";
 *
 *   await notify({
 *     recipientId: task.assigneeId,
 *     type: "task-assigned",
 *     title: "You were assigned a task",
 *     body: task.title,
 *     href: `/tasks#${task.id}`,
 *     entityType: "task",
 *     entityId: task.id,
 *     actorId: currentUser.id,
 *     email: {
 *       templateKey: "notification",
 *       data: {
 *         recipientName: assignee.name,
 *         heading: "You were assigned a task",
 *         body: task.title,
 *         cta: { label: "Open task", url: absoluteUrl(`/tasks#${task.id}`) },
 *       },
 *     },
 *   });
 *
 * Broadcasting: pass an array of recipientIds. Each recipient gets their
 * own Notification row (so per-user read state works) and one email.
 */

import { db } from "@/lib/db";
import { log } from "@/lib/log";
import { revalidatePath } from "next/cache";
import type { Notification } from "@prisma/client";
import { sendFromTemplate, type TemplateDataMap, type TemplateKey } from "@/lib/email";
import type { NotificationType } from "./types";

export { NOTIFICATION_TYPE_LABELS, type NotificationType } from "./types";

interface NotifyParams<K extends TemplateKey = TemplateKey> {
  /** One user id or many. Each recipient gets their own Notification row. */
  recipientId: string | string[];
  type: NotificationType;
  title: string;
  body?: string;
  /** Click target. Use relative URLs. */
  href?: string;
  entityType?: string;
  entityId?: string;
  /** Who triggered this. Null/undefined for system-generated notifications. */
  actorId?: string;
  /**
   * Also send this via email. The email goes to the recipient's email
   * address. If multiple recipients, each gets their own email. On failure
   * the in-app notification is still created — email errors don't block.
   */
  email?: {
    templateKey: K;
    data: TemplateDataMap[K];
  };
}

/**
 * Create notification rows for one or many recipients. Optionally fires
 * matching emails through the email layer.
 */
export async function notify<K extends TemplateKey = TemplateKey>(
  params: NotifyParams<K>
): Promise<Notification[]> {
  const recipients = Array.isArray(params.recipientId)
    ? params.recipientId
    : [params.recipientId];

  if (recipients.length === 0) return [];

  // Deduplicate — a broadcast shouldn't spam the same person twice
  const uniqueRecipients = Array.from(new Set(recipients));

  // Write one row per recipient. createManyAndReturn gives us the
  // created rows directly — the previous createMany + re-fetch by
  // (recipient, type, title, createdAt >= now) was racy under
  // concurrent identical notifications.
  const now = new Date();
  const created = await db.notification.createManyAndReturn({
    data: uniqueRecipients.map((recipientId) => ({
      recipientId,
      type: params.type,
      title: params.title,
      body: params.body || null,
      href: params.href || null,
      entityType: params.entityType || null,
      entityId: params.entityId || null,
      actorId: params.actorId || null,
      createdAt: now,
    })),
  });

  // Revalidate the affected users' notifications page + the global
  // /notifications view. The bell component does its own fetch on
  // client-side dropdown open, so it doesn't need explicit invalidation.
  revalidatePath("/notifications");
  for (const recipientId of uniqueRecipients) {
    revalidatePath(`/team/${recipientId}`);
  }

  // Fire-and-forget email if requested. We wait for completion so
  // EmailLog rows are consistent, but we swallow errors so notify()
  // itself always succeeds.
  if (params.email) {
    try {
      const users = await db.user.findMany({
        where: { id: { in: uniqueRecipients }, isActive: true },
        select: { id: true, email: true, hasLoginAccess: true },
      });
      for (const user of users) {
        // Skip no-login placeholder users (email is fake)
        if (!user.hasLoginAccess) continue;
        await sendFromTemplate(
          params.email.templateKey,
          params.email.data,
          {
            to: user.email,
            entityType: params.entityType,
            entityId: params.entityId,
          }
        );
      }
    } catch (err) {
      log.error("notifications.email", "Email delivery failed", err);
    }
  }

  return created;
}

/**
 * Mark a single notification as read. No-op if it's already read or
 * doesn't belong to the given user (prevents cross-user reads).
 */
export async function markAsRead(
  notificationId: string,
  userId: string
): Promise<void> {
  await db.notification.updateMany({
    where: { id: notificationId, recipientId: userId, readAt: null },
    data: { readAt: new Date() },
  });
  revalidatePath("/notifications");
}

/** Mark all of a user's unread notifications as read. */
export async function markAllAsRead(userId: string): Promise<number> {
  const result = await db.notification.updateMany({
    where: { recipientId: userId, readAt: null },
    data: { readAt: new Date() },
  });
  revalidatePath("/notifications");
  return result.count;
}

/** Delete a single notification (user can only delete their own). */
export async function deleteNotification(
  notificationId: string,
  userId: string
): Promise<void> {
  await db.notification.deleteMany({
    where: { id: notificationId, recipientId: userId },
  });
  revalidatePath("/notifications");
}

/** Count unread notifications for a user. */
export async function getUnreadCount(userId: string): Promise<number> {
  return db.notification.count({
    where: { recipientId: userId, readAt: null },
  });
}

/**
 * Count unread notifications for the bell.
 *
 * Round-5 QA: admins viewing /admin/notifications saw 9 unread
 * system-wide while their personal bell stayed bare because
 * `getUnreadCount(userId)` only counts notifications addressed to
 * that user. Admins legitimately want a system-wide signal —
 * they're the ones who'll triage anything an automated job
 * delivered to a mailbox the original recipient never opens. For
 * non-admin roles, per-recipient remains correct (a contributor
 * shouldn't see the count of someone else's mail).
 */
export async function getBellUnreadCount(
  userId: string,
  role: string
): Promise<number> {
  if (role === "ADMIN") {
    return db.notification.count({ where: { readAt: null } });
  }
  return getUnreadCount(userId);
}

/**
 * Fetch notifications for a user, newest first. Used by the bell dropdown
 * and the /notifications page.
 */
export async function getUserNotifications(
  userId: string,
  options: { limit?: number; unreadOnly?: boolean } = {}
): Promise<Notification[]> {
  return db.notification.findMany({
    where: {
      recipientId: userId,
      ...(options.unreadOnly ? { readAt: null } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: options.limit || 50,
  });
}
