"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Search, LogOut } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { signOut } from "next-auth/react";

interface HeaderProps {
  userName: string;
  userEmail: string;
  userRole: string;
}

export function Header({ userName, userEmail, userRole }: HeaderProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [showMenu, setShowMenu] = useState(false);
  const router = useRouter();

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      router.push(`/search?q=${encodeURIComponent(searchQuery.trim())}`);
    }
  };

  return (
    <header className="flex h-16 items-center justify-between border-b border-border bg-card px-4 sm:px-6">
      {/* Spacer for mobile hamburger button */}
      <div className="w-10 md:hidden" />

      <form onSubmit={handleSearch} className="flex items-center gap-2 flex-1 min-w-0 max-w-md">
        <Search className="h-4 w-4 text-muted-foreground shrink-0" />
        <input
          type="text"
          placeholder="Search..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground min-w-0"
        />
      </form>

      <div className="relative shrink-0">
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
            <button
              onClick={() => signOut({ callbackUrl: "/login" })}
              className="flex w-full items-center gap-2 px-3 py-2 text-sm text-destructive hover:bg-muted transition-colors"
            >
              <LogOut className="h-4 w-4" />
              Sign Out
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
