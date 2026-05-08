import { requireAuth } from "@/lib/permissions";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { getUserNotifications } from "@/lib/notifications";
import { NotificationsList } from "./notifications-list";
import { Bell } from "lucide-react";

export default async function NotificationsPage() {
  const user = await requireAuth();

  const notifications = await getUserNotifications(user.id, { limit: 100 });

  return (
    <div>
      <PageHeader
        title="Notifications"
        description="Everything happening across the projects and tasks you&rsquo;re involved in"
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
