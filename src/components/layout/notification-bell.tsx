"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { Bell, Check, Trash2 } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import {
  fetchRecent,
  markAsRead,
  markAllAsRead,
  deleteNotification,
} from "@/actions/notifications";

interface NotificationLite {
  id: string;
  type: string;
  title: string;
  body: string | null;
  href: string | null;
  readAt: string | null;
  createdAt: string;
}

interface Props {
  /** Server-rendered initial state so the bell has data on first paint */
  initialUnreadCount: number;
  initialNotifications: NotificationLite[];
}

export function NotificationBell({ initialUnreadCount, initialNotifications }: Props) {
  const [open, setOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(initialUnreadCount);
  const [notifications, setNotifications] = useState(initialNotifications);
  const [isPending, startTransition] = useTransition();
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Poll every 60s while the tab is visible. Cheap and reliable — can
  // upgrade to SSE/websockets later if notification volume demands it.
  // Round-5: also tick immediately on mount so the bell reflects the
  // latest count instead of the SSR snapshot for up to 60s. Without
  // this, an admin who just received a notification could see a bare
  // bell until the first interval fires, even though the popover
  // would show the unread row when opened.
  useEffect(() => {
    if (typeof document === "undefined") return;
    const tick = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const r = await fetchRecent(10);
        setUnreadCount(r.unreadCount);
        setNotifications(r.notifications);
      } catch {
        // Ignore — poll will retry next tick
      }
    };
    tick();
    const interval = window.setInterval(tick, 60_000);
    const onVisibility = () => {
      if (document.visibilityState === "visible") tick();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  // Refresh on dropdown open so it's always up-to-date when the user looks
  useEffect(() => {
    if (!open) return;
    startTransition(async () => {
      const r = await fetchRecent(10);
      setUnreadCount(r.unreadCount);
      setNotifications(r.notifications);
    });
  }, [open]);

  // Close dropdown when clicking outside
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const handleMarkRead = (id: string) => {
    startTransition(async () => {
      await markAsRead(id);
      setNotifications((prev) =>
        prev.map((n) => (n.id === id ? { ...n, readAt: new Date().toISOString() } : n))
      );
      setUnreadCount((c) => Math.max(0, c - 1));
    });
  };

  const handleMarkAllRead = () => {
    startTransition(async () => {
      const r = await markAllAsRead();
      setNotifications((prev) =>
        prev.map((n) => (n.readAt ? n : { ...n, readAt: new Date().toISOString() }))
      );
      setUnreadCount((c) => Math.max(0, c - (r.count || 0)));
    });
  };

  const handleDelete = (id: string) => {
    startTransition(async () => {
      await deleteNotification(id);
      setNotifications((prev) => prev.filter((n) => n.id !== id));
      // If it was unread, drop the count
      const wasUnread = notifications.find((n) => n.id === id)?.readAt === null;
      if (wasUnread) setUnreadCount((c) => Math.max(0, c - 1));
    });
  };

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="relative flex items-center justify-center h-9 w-9 rounded hover:bg-muted transition-colors"
        aria-label={
          unreadCount > 0
            ? `${unreadCount} unread notifications`
            : "Notifications"
        }
      >
        <Bell className="h-5 w-5" />
        {unreadCount > 0 && (
          <>
            {/* Bigger badge so the QA-flagged "looked empty" case is
                impossible: the red pill sits on top of the bell with a
                ring matching the header background and a subtle pulse
                so it pulls the eye on first render. aria-live="polite"
                announces count changes to screen readers without
                interrupting other speech. */}
            <span
              aria-live="polite"
              className="absolute -top-1 -right-1 flex h-5 min-w-[20px] items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold text-destructive-foreground ring-2 ring-background shadow-sm"
            >
              {unreadCount > 99 ? "99+" : unreadCount}
            </span>
            <span
              aria-hidden
              className="absolute -top-1 -right-1 inline-flex h-5 w-5 animate-ping rounded-full bg-destructive opacity-40"
            />
          </>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 w-80 rounded border border-border bg-card shadow-lg z-50">
          <div className="flex items-center justify-between border-b border-border px-3 py-2">
            <p className="text-sm font-semibold">Notifications</p>
            <div className="flex items-center gap-2">
              {unreadCount > 0 && (
                <button
                  onClick={handleMarkAllRead}
                  disabled={isPending}
                  className="text-xs text-muted-foreground hover:text-primary"
                >
                  Mark all read
                </button>
              )}
              <Link
                href="/notifications"
                onClick={() => setOpen(false)}
                className="text-xs text-primary hover:underline"
              >
                View all
              </Link>
            </div>
          </div>

          <div className="max-h-96 overflow-y-auto">
            {notifications.length === 0 ? (
              <div className="py-8 text-center text-xs text-muted-foreground">
                No notifications yet
              </div>
            ) : (
              notifications.map((n) => {
                const isUnread = !n.readAt;
                const inner = (
                  <div className="flex items-start gap-2 px-3 py-2.5 hover:bg-muted/40 transition-colors">
                    {isUnread ? (
                      <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary" />
                    ) : (
                      <span className="mt-1.5 h-2 w-2 shrink-0" />
                    )}
                    <div className="flex-1 min-w-0">
                      <p className={`text-xs ${isUnread ? "font-semibold" : "font-normal"} truncate`}>
                        {n.title}
                      </p>
                      {n.body && (
                        <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                          {n.body}
                        </p>
                      )}
                      <p className="text-[10px] text-muted-foreground/70 mt-1">
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
                          className="p-0.5 rounded hover:bg-muted text-muted-foreground/60 hover:text-primary"
                        >
                          <Check className="h-3 w-3" />
                        </button>
                      )}
                      <button
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          handleDelete(n.id);
                        }}
                        title="Delete"
                        className="p-0.5 rounded hover:bg-destructive/10 text-muted-foreground/60 hover:text-destructive"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  </div>
                );
                return n.href ? (
                  <Link
                    key={n.id}
                    href={n.href}
                    onClick={() => {
                      if (isUnread) handleMarkRead(n.id);
                      setOpen(false);
                    }}
                    className="block border-b border-border/40 last:border-b-0"
                  >
                    {inner}
                  </Link>
                ) : (
                  <div key={n.id} className="block border-b border-border/40 last:border-b-0">
                    {inner}
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
