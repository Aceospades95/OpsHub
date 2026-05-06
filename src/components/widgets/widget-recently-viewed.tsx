"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Building2,
  FolderKanban,
  User,
  Truck,
  FileText,
  ScrollText,
  Wrench,
  BookOpen,
  Award,
  History,
} from "lucide-react";

import { getRecent, type RecentEntry, type RecentEntityType } from "@/lib/recently-viewed";

const ICONS: Record<RecentEntityType, React.ComponentType<{ className?: string }>> = {
  project: FolderKanban,
  client: Building2,
  employee: User,
  supplier: Truck,
  contract: FileText,
  quote: ScrollText,
  tool: Wrench,
  intranet: BookOpen,
  subcontractor: Truck,
  partnership: Building2,
  certification: Award,
};

/**
 * Dashboard widget showing entities the viewer has recently opened.
 *
 * Reads from localStorage (see src/lib/recently-viewed.ts) so each
 * machine has its own list — no DB column, no cross-device sync.
 * Rendered client-side because localStorage isn't available during
 * SSR; the empty-state hint is what shows on first paint until the
 * effect fires.
 */
export function WidgetRecentlyViewed() {
  const [entries, setEntries] = useState<RecentEntry[]>([]);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setEntries(getRecent(8));
    setHydrated(true);
  }, []);

  return (
    <Card className="h-full">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <History className="h-4 w-4" /> Recently viewed
        </CardTitle>
      </CardHeader>
      <CardContent>
        {!hydrated ? (
          <p className="text-xs text-muted-foreground">Loading…</p>
        ) : entries.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            Open a project, client, or employee — they&rsquo;ll show up here for
            quick re-entry.
          </p>
        ) : (
          <div className="space-y-1">
            {entries.map((entry) => {
              const Icon = ICONS[entry.type];
              return (
                <Link
                  key={`${entry.type}-${entry.id}`}
                  href={entry.href}
                  className="flex items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted/40 transition-colors"
                >
                  <Icon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-medium" title={entry.label}>
                      {entry.label}
                    </p>
                    {entry.sublabel && (
                      <p
                        className="truncate text-[10px] text-muted-foreground"
                        title={entry.sublabel}
                      >
                        {entry.sublabel}
                      </p>
                    )}
                  </div>
                  <span className="text-[10px] text-muted-foreground/70 capitalize shrink-0">
                    {entry.type}
                  </span>
                </Link>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
