"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Check, Trash2, CheckCheck } from "lucide-react";
import { formatDistanceToNow, format } from "date-fns";
import { markAsRead, markAllAsRead, deleteNotification } from "@/actions/notifications";
import { NOTIFICATION_TYPE_LABELS, type NotificationType } from "@/lib/notifications/types";

interface NotificationItem {
  id: string;
  type: string;
  title: string;
  body: string | null;
  href: string | null;
  entityType: string | null;
  entityId: string | null;
  readAt: string | null;
  createdAt: string;
}

interface Props {
  initialNotifications: NotificationItem[];
}

export function NotificationsList({ initialNotifications }: Props) {
  const [notifications, setNotifications] = useState(initialNotifications);
  const [filter, setFilter] = useState<"all" | "unread">("all");
  const [isPending, startTransition] = useTransition();

  const filtered =
    filter === "unread" ? notifications.filter((n) => !n.readAt) : notifications;
  const unreadCount = notifications.filter((n) => !n.readAt).length;

  const handleMarkRead = (id: string) => {
    startTransition(async () => {
      await markAsRead(id);
      setNotifications((prev) =>
        prev.map((n) =>
          n.id === id ? { ...n, readAt: new Date().toISOString() } : n
        )
      );
    });
  };

  const handleMarkAllRead = () => {
    startTransition(async () => {
      await markAllAsRead();
      setNotifications((prev) =>
        prev.map((n) => (n.readAt ? n : { ...n, readAt: new Date().toISOString() }))
      );
    });
  };

  const handleDelete = (id: string) => {
    startTransition(async () => {
      await deleteNotification(id);
      setNotifications((prev) => prev.filter((n) => n.id !== id));
    });
  };

  return (
    <div className="space-y-4">
      {/* Filters + actions */}
      <div className="flex items-center justify-between">
        <div className="flex rounded-md border border-border overflow-hidden">
          <button
            onClick={() => setFilter("all")}
            className={`px-3 py-1.5 text-xs font-medium transition-colors ${
              filter === "all" ? "bg-primary text-primary-foreground" : "hover:bg-muted"
            }`}
          >
            All ({notifications.length})
          </button>
          <button
            onClick={() => setFilter("unread")}
            className={`px-3 py-1.5 text-xs font-medium transition-colors ${
              filter === "unread" ? "bg-primary text-primary-foreground" : "hover:bg-muted"
            }`}
          >
            Unread ({unreadCount})
          </button>
        </div>
        {unreadCount > 0 && (
          <Button
            variant="outline"
            size="sm"
            onClick={handleMarkAllRead}
            disabled={isPending}
          >
            <CheckCheck className="h-4 w-4 mr-1.5" />
            Mark all read
          </Button>
        )}
      </div>

      {/* List */}
      {filtered.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            {filter === "unread" ? "No unread notifications" : "No notifications"}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {filtered.map((n) => {
            const isUnread = !n.readAt;
            const typeLabel =
              NOTIFICATION_TYPE_LABELS[n.type as NotificationType] || n.type;
            const body = (
              <div className="flex items-start gap-3 p-4">
                {isUnread ? (
                  <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary" />
                ) : (
                  <span className="mt-1.5 h-2 w-2 shrink-0" />
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p
                      className={`text-sm ${isUnread ? "font-semibold" : "font-normal"}`}
                    >
                      {n.title}
                    </p>
                    <Badge variant="outline" className="text-[10px]">
                      {typeLabel}
                    </Badge>
                  </div>
                  {n.body && (
                    <p className="text-xs text-muted-foreground mt-1">{n.body}</p>
                  )}
                  <p
                    className="text-[10px] text-muted-foreground/70 mt-1.5"
                    title={format(new Date(n.createdAt), "yyyy-MM-dd HH:mm:ss")}
                  >
                    {formatDistanceToNow(new Date(n.createdAt), { addSuffix: true })}
                  </p>
                </div>
                <div className="flex flex-col gap-1">
                  {isUnread && (
                    <button
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        handleMarkRead(n.id);
                      }}
                      title="Mark read"
                      className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-primary"
                    >
                      <Check className="h-3.5 w-3.5" />
                    </button>
                  )}
                  <button
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      handleDelete(n.id);
                    }}
                    title="Delete"
                    className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            );

            return n.href ? (
              <Card key={n.id}>
                <Link
                  href={n.href}
                  onClick={() => isUnread && handleMarkRead(n.id)}
                  className="block hover:bg-muted/30 transition-colors rounded-md"
                >
                  {body}
                </Link>
              </Card>
            ) : (
              <Card key={n.id}>{body}</Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
