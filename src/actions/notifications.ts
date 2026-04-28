"use server";

import { requireAuth } from "@/lib/permissions";
import {
  notify,
  markAsRead as markAsReadLib,
  markAllAsRead as markAllAsReadLib,
  deleteNotification as deleteNotificationLib,
  getUnreadCount,
  getUserNotifications,
} from "@/lib/notifications";
import { db } from "@/lib/db";
import { revalidatePath } from "next/cache";

/** Mark a notification as read. Users can only read their own. */
export async function markAsRead(notificationId: string) {
  const user = await requireAuth();
  await markAsReadLib(notificationId, user.id);
  return { success: true };
}

/** Mark all of the current user's notifications as read. */
export async function markAllAsRead() {
  const user = await requireAuth();
  const count = await markAllAsReadLib(user.id);
  return { success: true, count };
}

/** Delete a single notification. Users can only delete their own. */
export async function deleteNotification(notificationId: string) {
  const user = await requireAuth();
  await deleteNotificationLib(notificationId, user.id);
  return { success: true };
}

/**
 * Fetch current user's recent notifications. Used by the bell dropdown's
 * client-side refresh.
 */
export async function fetchRecent(limit = 10) {
  const user = await requireAuth();
  const [notifications, unreadCount] = await Promise.all([
    getUserNotifications(user.id, { limit }),
    getUnreadCount(user.id),
  ]);
  return {
    notifications: notifications.map((n) => ({
      id: n.id,
      type: n.type,
      title: n.title,
      body: n.body,
      href: n.href,
      readAt: n.readAt?.toISOString() || null,
      createdAt: n.createdAt.toISOString(),
    })),
    unreadCount,
  };
}

/**
 * Send a test notification to the current admin. Useful for verifying the
 * notification + email pipeline without waiting for a real event.
 */
export async function sendTestNotification(params: { withEmail: boolean }) {
  const user = await requireAuth();
  if (user.role !== "ADMIN") return { error: "Admin access required" } as const;

  await notify({
    recipientId: user.id,
    type: "test",
    title: "Test notification",
    body: `Sent at ${new Date().toLocaleString()}. If you see this in the bell dropdown, the notification pipeline is working.`,
    href: "/notifications",
    actorId: user.id,
    email: params.withEmail
      ? {
          templateKey: "notification",
          data: {
            recipientName: user.name,
            heading: "Test notification from OpsHub",
            body: "This is a test notification sent from the admin panel. You can safely ignore it.",
            cta: {
              label: "View notifications",
              url: `${process.env.NEXTAUTH_URL || "http://localhost:3000"}/notifications`,
            },
          },
        }
      : undefined,
  });

  revalidatePath("/admin/notifications");
  revalidatePath("/notifications");
  return { success: true };
}

/** Admin-only: delete an arbitrary notification regardless of recipient. */
export async function adminDeleteNotification(notificationId: string) {
  const user = await requireAuth();
  if (user.role !== "ADMIN") return { error: "Admin access required" } as const;

  await db.notification.delete({ where: { id: notificationId } });
  revalidatePath("/admin/notifications");
  return { success: true };
}
