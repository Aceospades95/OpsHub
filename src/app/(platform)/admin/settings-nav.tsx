"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowLeft } from "lucide-react";

/**
 * Breadcrumb that appears at the top of every admin sub-page, linking
 * back to the Settings hub. Hidden on the hub page itself (/admin).
 */
export function SettingsNav() {
  const pathname = usePathname();
  // Don't show on the settings hub itself
  if (pathname === "/admin") return null;

  return (
    <Link
      href="/admin"
      className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground mb-4"
    >
      <ArrowLeft className="h-3 w-3" />
      Back to Settings
    </Link>
  );
}
