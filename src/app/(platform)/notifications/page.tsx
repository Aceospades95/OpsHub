import { requireAuth } from "@/lib/permissions";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
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
        <Card>
          <CardContent className="py-16 text-center text-muted-foreground">
            <Bell className="h-12 w-12 mx-auto mb-3 opacity-40" />
            <p className="text-sm">You&rsquo;re all caught up — no notifications yet.</p>
            <p className="text-xs mt-2">When something happens that involves you, it&rsquo;ll show up here.</p>
          </CardContent>
        </Card>
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
