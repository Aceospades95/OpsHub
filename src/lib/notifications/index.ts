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
import type { Notification, NotificationRule } from "@prisma/client";
import { sendFromTemplate, type TemplateDataMap, type TemplateKey } from "@/lib/email";
import type { NotificationType } from "./types";

export { NOTIFICATION_TYPE_LABELS, type NotificationType } from "./types";
export {
  NOTIFICATION_TYPE_REGISTRY,
  NOTIFICATION_TYPE_INFO,
  TEMPLATE_VARIABLES,
  type NotificationTypeInfo,
} from "./registry";

/**
 * {{variable}} substitution for rule subject/body templates. Unknown
 * variables render as empty strings — a typo degrades to a blank, not
 * a crash or a leaked placeholder.
 */
function substituteVars(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, key: string) => vars[key] ?? "");
}

/**
 * Load the admin-configured rule for a type. Null (no row / lookup
 * failure) = stock behavior, so the rules layer can never take
 * notifications down.
 */
async function resolveRule(type: NotificationType): Promise<NotificationRule | null> {
  try {
    return await db.notificationRule.findUnique({ where: { typeKey: type } });
  } catch (err) {
    log.error("notifications.rules", "Rule lookup failed", err, { type });
    return null;
  }
}

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
  /**
   * Skip the rule's ADDED recipients (roles/users/extra emails) while
   * still honoring enabled/channels/templates — used by the admin
   * "test this rule" button so a test reaches only the tester.
   */
  suppressRuleRecipients?: boolean;
}

/**
 * Create notification rows for one or many recipients. Optionally fires
 * matching emails through the email layer.
 *
 * THE RULES LAYER — before anything sends, the type's NotificationRule
 * (admin-editable at /admin/notifications) is consulted:
 *   - enabled=false          → nothing sends, either channel
 *   - throttleHours          → repeat sends for the same type+entity
 *                              inside the window are suppressed
 *   - recipientRoles/UserIds → ADDED to the caller's recipients
 *   - channelInApp/Email     → per-channel gates
 *   - subject/bodyTemplate   → override the outgoing email's heading and
 *                              body ({{variables}} — see registry.ts)
 *   - extraEmails            → raw addresses that get their own copy
 * No rule row = stock behavior. Emails are personalized per recipient:
 * the "notification" template's recipientName is set to each
 * addressee's real name (callers used to hand-loop for this).
 */
export async function notify<K extends TemplateKey = TemplateKey>(
  params: NotifyParams<K>
): Promise<Notification[]> {
  const recipients = Array.isArray(params.recipientId)
    ? params.recipientId
    : [params.recipientId];

  const rule = await resolveRule(params.type);
  if (rule && !rule.enabled) return [];

  // Throttle: same type + same entity inside the window → suppressed
  // entirely (both channels). Entity-less notifications can't throttle.
  if (rule?.throttleHours && params.entityId) {
    const windowStart = new Date(Date.now() - rule.throttleHours * 60 * 60 * 1000);
    const recent = await db.notification.findFirst({
      where: {
        type: params.type,
        entityId: params.entityId,
        createdAt: { gte: windowStart },
      },
      select: { id: true },
    });
    if (recent) return [];
  }

  // Recipient set = caller's recipients + rule-added roles/users, all
  // resolved against ACTIVE users (also gives us names for email
  // personalization in one query).
  const expandRule = rule && !params.suppressRuleRecipients ? rule : null;
  const candidateIds = new Set(recipients);
  if (expandRule) {
    for (const id of expandRule.recipientUserIds) candidateIds.add(id);
  }
  const roleUsers =
    expandRule && expandRule.recipientRoles.length > 0
      ? await db.user.findMany({
          // Role is an enum column; filter in JS so an outdated stored
          // role string can't throw a Prisma enum-cast error.
          where: { isActive: true },
          select: { id: true, role: true },
        })
      : [];
  for (const u of roleUsers) {
    if (expandRule!.recipientRoles.includes(u.role)) candidateIds.add(u.id);
  }

  if (candidateIds.size === 0 && (expandRule?.extraEmails.length ?? 0) === 0) return [];

  const users = await db.user.findMany({
    where: { id: { in: Array.from(candidateIds) }, isActive: true },
    select: {
      id: true,
      name: true,
      email: true,
      hasLoginAccess: true,
      notificationEmailDigest: true,
    },
  });

  // Per-user mutes (set on /notifications → Preferences) apply after
  // the rule expands recipients: a mute always wins for that person,
  // per channel, regardless of who added them.
  const prefs =
    users.length > 0
      ? await db.userNotificationPref.findMany({
          where: { typeKey: params.type, userId: { in: users.map((u) => u.id) } },
        })
      : [];
  const prefByUser = new Map(prefs.map((p) => [p.userId, p]));

  // No-login placeholder users can never open /notifications — writing
  // rows for them is dead weight (they're already skipped for email).
  const inAppRecipients = users
    .filter((u) => u.hasLoginAccess && !prefByUser.get(u.id)?.muteInApp)
    .map((u) => u.id);

  // Write one row per recipient. createManyAndReturn gives us the
  // created rows directly — the previous createMany + re-fetch by
  // (recipient, type, title, createdAt >= now) was racy under
  // concurrent identical notifications.
  const now = new Date();
  let created: Notification[] = [];
  if (inAppRecipients.length > 0 && rule?.channelInApp !== false) {
    created = await db.notification.createManyAndReturn({
      data: inAppRecipients.map((recipientId) => ({
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
    for (const recipientId of inAppRecipients) {
      revalidatePath(`/team/${recipientId}`);
    }
  }

  // Fire-and-forget email if requested. We wait for completion so
  // EmailLog rows are consistent, but we swallow errors so notify()
  // itself always succeeds.
  if (params.email && rule?.channelEmail !== false) {
    try {
      // Rule overrides apply to the generic "notification" template
      // (heading doubles as the subject there). Other templates carry
      // bespoke typed data the admin can't safely rewrite.
      const isGenericTemplate = params.email.templateKey === "notification";
      const baseData = params.email.data as unknown as Record<string, unknown>;

      const renderFor = (recipientName: string): TemplateDataMap[K] => {
        const vars: Record<string, string> = {
          recipientName,
          title: params.title,
          body: params.body ?? "",
          heading: isGenericTemplate ? String(baseData.heading ?? params.title) : params.title,
          emailBody: isGenericTemplate ? String(baseData.body ?? params.body ?? "") : params.body ?? "",
          href: params.href ?? "",
        };
        const data: Record<string, unknown> = { ...baseData };
        if ("recipientName" in data) data.recipientName = recipientName;
        if (isGenericTemplate && rule?.subjectTemplate) {
          data.heading = substituteVars(rule.subjectTemplate, vars);
        }
        if (isGenericTemplate && rule?.bodyTemplate) {
          data.body = substituteVars(rule.bodyTemplate, vars);
        }
        return data as unknown as TemplateDataMap[K];
      };

      for (const user of users) {
        // Skip no-login placeholder users (email is fake)
        if (!user.hasLoginAccess) continue;
        // Per-user email mute (set on /notifications → Preferences).
        if (prefByUser.get(user.id)?.muteEmail) continue;
        // Digest mode: the in-app row above is the record; the
        // notification-email-digest job batches it into one daily
        // email instead of an immediate send.
        if (user.notificationEmailDigest) continue;
        // Per-recipient isolation: one rejected send (e.g. a template
        // render throw, which escapes sendFromTemplate's driver-level
        // catch) must not starve the remaining recipients.
        try {
          await sendFromTemplate(params.email.templateKey, renderFor(user.name), {
            to: user.email,
            entityType: params.entityType,
            entityId: params.entityId,
          });
        } catch (err) {
          log.error("notifications.email", "Email delivery failed", err, {
            recipientId: user.id,
          });
        }
      }

      // Raw external addresses from the rule get their own copies.
      for (const address of expandRule?.extraEmails ?? []) {
        if (!address.includes("@")) continue;
        try {
          await sendFromTemplate(params.email.templateKey, renderFor("team"), {
            to: address,
            entityType: params.entityType,
            entityId: params.entityId,
          });
        } catch (err) {
          log.error("notifications.email", "Email delivery failed", err);
        }
      }
    } catch (err) {
      // Backstop for failures outside the per-send isolation (e.g.
      // building renderFor inputs) — notify() itself must never throw
      // over email problems once in-app rows are written.
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
