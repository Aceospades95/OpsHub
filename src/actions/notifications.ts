"use server";

import { requireAuth } from "@/lib/permissions";
import {
  notify,
  markAsRead as markAsReadLib,
  markAllAsRead as markAllAsReadLib,
  deleteNotification as deleteNotificationLib,
  getBellUnreadCount,
  getUserNotifications,
  NOTIFICATION_TYPE_INFO,
  type NotificationType,
} from "@/lib/notifications";
import { db } from "@/lib/db";
import { logActivity } from "@/lib/activity";
import { Role } from "@prisma/client";
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
    getBellUnreadCount(user.id, user.role),
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

// ─── Notification rules (the engine's admin-editable layer) ─────────

export interface NotificationRuleInput {
  typeKey: string;
  enabled: boolean;
  channelInApp: boolean;
  channelEmail: boolean;
  recipientRoles: string[];
  recipientUserIds: string[];
  /** Raw textarea — comma/whitespace separated addresses. */
  extraEmails: string;
  subjectTemplate: string;
  bodyTemplate: string;
  /** "" = no throttle. */
  throttleHours: string;
}

/**
 * Save (upsert) the delivery rule for a notification type. Validated
 * against the type registry + Role enum so a crafted POST can't park
 * junk the engine would then trip over.
 */
export async function saveNotificationRule(input: NotificationRuleInput) {
  const user = await requireAuth();
  if (user.role !== "ADMIN") return { error: "Admin access required" } as const;

  if (!NOTIFICATION_TYPE_INFO.has(input.typeKey as NotificationType)) {
    return { error: `Unknown notification type "${input.typeKey}"` } as const;
  }
  const validRoles = Object.values(Role) as string[];
  const roles = input.recipientRoles.filter((r) => validRoles.includes(r));
  if (roles.length !== input.recipientRoles.length) {
    return { error: "Unknown role in the added-recipients list" } as const;
  }

  const userIds = Array.from(new Set(input.recipientUserIds)).slice(0, 50);
  if (userIds.length > 0) {
    const found = await db.user.count({ where: { id: { in: userIds } } });
    if (found !== userIds.length) {
      return { error: "One of the added users no longer exists" } as const;
    }
  }

  const extraEmails = Array.from(
    new Set(
      input.extraEmails
        .split(/[,;\s]+/)
        .map((s) => s.trim())
        .filter(Boolean)
    )
  ).slice(0, 20);
  for (const address of extraEmails) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) {
      return { error: `"${address}" doesn't look like an email address` } as const;
    }
  }

  let throttleHours: number | null = null;
  if (input.throttleHours.trim() !== "") {
    const n = Number(input.throttleHours);
    if (!Number.isFinite(n) || n < 1 || n > 720) {
      return { error: "Throttle must be between 1 and 720 hours (or blank)" } as const;
    }
    throttleHours = Math.round(n);
  }

  const data = {
    enabled: input.enabled,
    channelInApp: input.channelInApp,
    channelEmail: input.channelEmail,
    recipientRoles: roles,
    recipientUserIds: userIds,
    extraEmails,
    subjectTemplate: input.subjectTemplate.trim().slice(0, 300) || null,
    bodyTemplate: input.bodyTemplate.trim().slice(0, 2000) || null,
    throttleHours,
  };
  await db.notificationRule.upsert({
    where: { typeKey: input.typeKey },
    update: data,
    create: { typeKey: input.typeKey, ...data },
  });
  await logActivity("updated", "notification-rule", input.typeKey, user.id, input.typeKey);
  revalidatePath("/admin/notifications");
  return { success: true } as const;
}

/** Delete a rule → the type reverts to stock code behavior. */
export async function resetNotificationRule(typeKey: string) {
  const user = await requireAuth();
  if (user.role !== "ADMIN") return { error: "Admin access required" } as const;

  await db.notificationRule.deleteMany({ where: { typeKey } });
  await logActivity("deleted", "notification-rule", typeKey, user.id, `${typeKey} reset to defaults`);
  revalidatePath("/admin/notifications");
  return { success: true } as const;
}

/**
 * Send a sample notification of the given type to the calling admin so
 * rule overrides (subject/body templates, channel toggles) can be seen
 * end-to-end without waiting for the real event.
 */
export async function sendRuleTest(typeKey: string) {
  const user = await requireAuth();
  if (user.role !== "ADMIN") return { error: "Admin access required" } as const;

  const info = NOTIFICATION_TYPE_INFO.get(typeKey as NotificationType);
  if (!info) return { error: `Unknown notification type "${typeKey}"` } as const;

  await notify({
    recipientId: user.id,
    type: info.key,
    suppressRuleRecipients: true,
    title: `Sample — ${info.label}`,
    body: `Rule test for "${info.label}" sent from /admin/notifications. Real trigger: ${info.trigger}.`,
    href: "/admin/notifications",
    actorId: user.id,
    email: {
      templateKey: "notification",
      data: {
        recipientName: user.name ?? "Admin",
        heading: `Sample — ${info.label}`,
        body: `This is a rule test for the "${info.label}" notification type. If the rule sets a subject or body template, this email reflects it.`,
        cta: {
          label: "Open notification rules",
          url: `${process.env.NEXTAUTH_URL || "http://localhost:3000"}/admin/notifications`,
        },
      },
    },
  });
  revalidatePath("/admin/notifications");
  return { success: true } as const;
}
