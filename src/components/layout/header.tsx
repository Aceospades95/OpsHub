"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Search, LogOut, User, Settings } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { signOut } from "next-auth/react";
import { NotificationBell } from "./notification-bell";
import { openCommandPalette } from "./command-palette";

interface NotificationLite {
  id: string;
  type: string;
  title: string;
  body: string | null;
  href: string | null;
  readAt: string | null;
  createdAt: string;
}

interface HeaderProps {
  userId: string;
  userName: string;
  userEmail: string;
  userRole: string;
  unreadNotifications: number;
  recentNotifications: NotificationLite[];
}

export function Header({
  userId,
  userName,
  userEmail,
  userRole,
  unreadNotifications,
  recentNotifications,
}: HeaderProps) {
  const [showMenu, setShowMenu] = useState(false);
  const [isMac, setIsMac] = useState(false);

  const isAdmin = userRole === "ADMIN";

  // Match the platform-mod-key hint to the user's OS so the kbd label
  // is correct on each machine. Default rendering during SSR shows
  // ⌘K and corrects on hydration — both shortcuts work either way.
  useEffect(() => {
    if (typeof navigator === "undefined") return;
    setIsMac(/Mac|iPhone|iPad/.test(navigator.platform));
  }, []);

  return (
    <header className="flex h-16 items-center border-b border-border bg-card px-4 sm:px-6 gap-4">
      {/* Spacer for mobile hamburger button */}
      <div className="w-10 md:hidden shrink-0" />

      {/* Search trigger — opens the Cmd-K command palette. The QA stress
       *  test flagged that the prior input did nothing on submit (it
       *  navigated to /search?q=… which doesn't exist as a route, so
       *  Enter 404'd silently). Now it's a button-styled trigger that
       *  hands off to the palette, which is mounted once at the layout
       *  level. The palette also opens via ⌘K / Ctrl-K from anywhere. */}
      <button
        type="button"
        onClick={() => openCommandPalette()}
        className="flex items-center gap-2 flex-1 min-w-0 max-w-md rounded border border-input bg-background px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted/40 transition-colors"
        aria-label="Open command palette"
      >
        <Search className="h-4 w-4 shrink-0" />
        <span className="flex-1 text-left truncate">
          Search projects, employees, clients…
        </span>
        <span className="hidden sm:inline-block rounded border border-border bg-card px-1.5 py-0.5 text-[10px] font-mono">
          {isMac ? "⌘K" : "Ctrl K"}
        </span>
      </button>

      {/* Right side — bell + user menu grouped together */}
      <div className="flex items-center gap-2 shrink-0">
        <NotificationBell
          initialUnreadCount={unreadNotifications}
          initialNotifications={recentNotifications}
        />

        <div className="relative">
          <button
            onClick={() => setShowMenu(!showMenu)}
            className="flex items-center gap-2 sm:gap-3 rounded px-2 py-1 hover:bg-muted transition-colors"
          >
            <div className="text-right hidden sm:block">
              <p className="text-sm font-medium">{userName}</p>
              <p className="text-xs text-muted-foreground">{userRole}</p>
            </div>
            <Avatar name={userName} size="sm" />
          </button>

          {showMenu && (
            <div className="absolute right-0 top-full mt-1 w-48 rounded border border-border bg-card shadow-lg z-50">
              <div className="p-3 border-b border-border">
                <p className="text-sm font-medium">{userName}</p>
                <p className="text-xs text-muted-foreground">{userEmail}</p>
              </div>
              <Link
                href={`/team/${userId}`}
                onClick={() => setShowMenu(false)}
                className="flex w-full items-center gap-2 px-3 py-2 text-sm hover:bg-muted transition-colors"
              >
                <User className="h-4 w-4" />
                Profile
              </Link>
              {isAdmin && (
                <Link
                  href="/admin"
                  onClick={() => setShowMenu(false)}
                  className="flex w-full items-center gap-2 px-3 py-2 text-sm hover:bg-muted transition-colors"
                >
                  <Settings className="h-4 w-4" />
                  Settings
                </Link>
              )}
              <div className="border-t border-border">
                <button
                  onClick={() => signOut({ callbackUrl: "/login" })}
                  className="flex w-full items-center gap-2 px-3 py-2 text-sm text-destructive hover:bg-muted transition-colors"
                >
                  <LogOut className="h-4 w-4" />
                  Sign Out
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
