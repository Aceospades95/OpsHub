import { requireAuth } from "@/lib/permissions";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Bell, CheckCircle2 } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import Link from "next/link";
import { NotificationsAdminActions } from "./notifications-admin-actions";
import { NOTIFICATION_TYPE_LABELS, type NotificationType } from "@/lib/notifications/types";

export const metadata = { title: "Notifications · OpsHub" };

export default async function AdminNotificationsPage() {
  const user = await requireAuth();
  if (user.role !== "ADMIN") redirect("/dashboard");

  const [notifications, totals, typeStats] = await Promise.all([
    db.notification.findMany({
      orderBy: { createdAt: "desc" },
      take: 100,
      include: {
        recipient: { select: { id: true, name: true } },
        actor: { select: { id: true, name: true } },
      },
    }),
    db.notification.groupBy({
      by: ["readAt"],
      _count: { _all: true },
    }),
    db.notification.groupBy({
      by: ["type"],
      _count: { _all: true },
      orderBy: { _count: { type: "desc" } },
      take: 10,
    }),
  ]);

  // Aggregate unread/read — the groupBy above gives us rows keyed on readAt
  // which is null for unread and a timestamp for read. Split into two counts.
  const unreadTotal = totals
    .filter((t) => t.readAt === null)
    .reduce((acc, t) => acc + t._count._all, 0);
  const readTotal = totals
    .filter((t) => t.readAt !== null)
    .reduce((acc, t) => acc + t._count._all, 0);

  return (
    <div>
      <PageHeader
        title="Notifications"
        description="Audit log of every in-app notification created by the platform"
        actions={<NotificationsAdminActions />}
      />

      {/* Stats banner */}
      <Card className="mb-6">
        <CardContent className="py-4 flex items-center gap-3">
          <Bell className="h-5 w-5 text-muted-foreground" />
          <div className="flex-1">
            <p className="text-sm">Notification system status</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              In-app notifications write to the Notification table. When the caller
              supplies an <code>email</code> block, notify() also fires through the
              email layer from session 5 (currently the{" "}
              <code>{process.env.EMAIL_DRIVER || "log"}</code> driver).
            </p>
          </div>
          <div className="flex gap-4">
            <div className="text-center">
              <p className="text-2xl font-semibold text-primary">{unreadTotal}</p>
              <p className="text-xs text-muted-foreground">Unread</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-semibold text-success">{readTotal}</p>
              <p className="text-xs text-muted-foreground">Read</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* By type breakdown */}
      {typeStats.length > 0 && (
        <Card className="mb-6">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">By type</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {typeStats.map((s) => (
                <div
                  key={s.type}
                  className="rounded border border-border px-3 py-1.5"
                >
                  <p className="text-xs text-muted-foreground">
                    {NOTIFICATION_TYPE_LABELS[s.type as NotificationType] || s.type}
                  </p>
                  <p className="text-sm font-medium">{s._count._all}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Recent list */}
      <Card>
        <CardHeader>
          <CardTitle>Recent (last 100)</CardTitle>
        </CardHeader>
        <CardContent>
          {notifications.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground">
              <Bell className="h-12 w-12 mx-auto mb-3 opacity-40" />
              <p className="text-sm">No notifications sent yet.</p>
              <p className="text-xs mt-2">
                Use the &ldquo;Send test&rdquo; button above to verify the pipeline.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {notifications.map((n) => (
                <div
                  key={n.id}
                  className="flex items-start gap-3 rounded border border-border p-3 hover:bg-muted/30 transition-colors"
                >
                  {n.readAt ? (
                    <CheckCircle2 className="h-4 w-4 text-success mt-0.5 shrink-0" />
                  ) : (
                    <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary" />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium truncate">{n.title}</p>
                      <Badge variant="outline" className="text-[10px]">
                        {NOTIFICATION_TYPE_LABELS[n.type as NotificationType] || n.type}
                      </Badge>
                    </div>
                    {n.body && (
                      <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                        {n.body}
                      </p>
                    )}
                    <p className="text-[10px] text-muted-foreground/70 mt-1">
                      To:{" "}
                      <Link
                        href={`/team/${n.recipient.id}`}
                        className="hover:text-primary hover:underline"
                      >
                        {n.recipient.name}
                      </Link>
                      {n.actor && (
                        <>
                          {" "}
                          · From:{" "}
                          <Link
                            href={`/team/${n.actor.id}`}
                            className="hover:text-primary hover:underline"
                          >
                            {n.actor.name}
                          </Link>
                        </>
                      )}
                      {n.entityType && n.entityId && (
                        <>
                          {" "}
                          · Ref: {n.entityType}:{n.entityId}
                        </>
                      )}
                    </p>
                  </div>
                  <div className="text-xs text-muted-foreground text-right shrink-0">
                    {formatDistanceToNow(n.createdAt, { addSuffix: true })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
