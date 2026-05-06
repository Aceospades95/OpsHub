"use client";

import { useEffect } from "react";
import { trackRecent, type RecentEntityType } from "@/lib/recently-viewed";

interface Props {
  type: RecentEntityType;
  id: string;
  label: string;
  sublabel?: string;
  href: string;
}

/**
 * Renders nothing — exists purely to write into the recently-viewed
 * localStorage list when an entity detail page mounts. Each detail
 * page (project / client / employee / supplier / contract / quote /
 * etc) drops one of these in its render tree with the row's metadata.
 */
export function RecentlyViewedTracker({
  type,
  id,
  label,
  sublabel,
  href,
}: Props) {
  useEffect(() => {
    trackRecent({ type, id, label, sublabel, href });
  }, [type, id, label, sublabel, href]);
  return null;
}
