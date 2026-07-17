import { requireAuth } from "@/lib/permissions";
import { db } from "@/lib/db";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { getUserNotifications, NOTIFICATION_TYPE_REGISTRY } from "@/lib/notifications";
import { NotificationsList } from "./notifications-list";
import { NotificationPreferences } from "./notification-preferences";
import { Bell } from "lucide-react";

export default async function NotificationsPage() {
  const user = await requireAuth();

  const [notifications, myPrefs, me] = await Promise.all([
    getUserNotifications(user.id, { limit: 100 }),
    db.userNotificationPref.findMany({ where: { userId: user.id } }),
    db.user.findUnique({
      where: { id: user.id },
      select: { notificationEmailDigest: true },
    }),
  ]);

  return (
    <div>
      <PageHeader
        title="Notifications"
        description="Everything happening across the projects and tasks you&rsquo;re involved in"
      />

      <NotificationPreferences
        types={NOTIFICATION_TYPE_REGISTRY.filter((t) => t.key !== "test")}
        prefs={myPrefs.map((p) => ({
          typeKey: p.typeKey,
          muteInApp: p.muteInApp,
          muteEmail: p.muteEmail,
        }))}
        emailDigest={me?.notificationEmailDigest ?? false}
      />

      {notifications.length === 0 ? (
        <EmptyState
          icon={Bell}
          title="You're all caught up"
          description="When something happens that involves you, it'll show up here."
        />
      ) : (
        <NotificationsList
          initialNotifications={notifications.map((n) => ({
            id: n.id,
            type: n.type,
            title: n.title,
            body: n.body,
            href: n.href,
            entityType: n.entityType,
            entityId: n.entityId,
            readAt: n.readAt?.toISOString() || null,
            createdAt: n.createdAt.toISOString(),
          }))}
        />
      )}
    </div>
  );
}
