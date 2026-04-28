"use client";

/**
 * OrgChartTree — public API + lazy wrapper around the d3-org-chart
 * canvas.
 *
 * The actual chart rendering lives in `./org-chart-canvas` and is
 * imported via next/dynamic({ ssr: false }) so d3-org-chart never
 * touches the server bundle. d3-org-chart's `main` field points at a
 * UMD bundle (`build/d3-org-chart.min.js`) whose top-level wrapper
 * references `this`, which is `undefined` in ESM strict mode — the
 * Next.js server then crashes on import. Loading it client-only
 * sidesteps that entirely.
 *
 * Callers depend on three exports:
 *   - `OrgChartTree` (the component)
 *   - `OrgChartNode` (the input shape)
 *   - `buildOrgTree` (helper to convert a flat user list into the tree)
 *
 * They keep stable signatures here so swapping the renderer in the
 * future is a one-file change.
 */

import dynamic from "next/dynamic";

export interface OrgChartNode {
  id: string;
  name: string;
  jobTitle?: string;
  department?: string;
  location?: string;
  avatar?: string | null;
  role?: string;
  href?: string;
  children: OrgChartNode[];
}

export interface OrgChartTreeProps {
  nodes: OrgChartNode[];
  /** Highlight cards whose name/jobTitle/department contains this. */
  highlight?: string;
  /** When set, clicking a card calls onCardClick instead of navigating
   *  via the card's `href`. Used by the team page's edit drawer. */
  onCardClick?: (id: string) => void;
  /** Hide the "Top of org" wrapper header when there's only one root. */
  hideTopHeaderForSingleRoot?: boolean;
}

const OrgChartCanvas = dynamic(() => import("./org-chart-canvas"), {
  ssr: false,
  loading: () => (
    <div
      className="rounded border border-border bg-muted/20 flex items-center justify-center text-xs text-muted-foreground"
      style={{ height: "75vh" }}
    >
      Loading org chart…
    </div>
  ),
});

export function OrgChartTree(props: OrgChartTreeProps) {
  return <OrgChartCanvas {...props} />;
}

// ─── Tree builder ────────────────────────────────────────────────────────

/**
 * Build a tree of `OrgChartNode` from a flat user list. Detects cycles
 * (A → B → A) and pushes any cycle participants to the roots so the
 * renderer never recurses forever. Drops self-references silently.
 */
export function buildOrgTree(
  users: {
    id: string;
    name: string;
    jobTitle?: string | null;
    department?: string | null;
    location?: string | null;
    avatar?: string | null;
    role?: string;
    managerId?: string | null;
    href?: string;
  }[]
): OrgChartNode[] {
  const map = new Map<string, OrgChartNode>();
  const userById = new Map(users.map((u) => [u.id, u]));

  for (const u of users) {
    map.set(u.id, {
      id: u.id,
      name: u.name,
      jobTitle: u.jobTitle || undefined,
      department: u.department || undefined,
      location: u.location || undefined,
      avatar: u.avatar,
      role: u.role,
      href: u.href,
      children: [],
    });
  }

  const roots: OrgChartNode[] = [];

  for (const u of users) {
    const node = map.get(u.id)!;
    if (u.managerId && map.has(u.managerId) && u.managerId !== u.id) {
      let current: string | null = u.managerId;
      let isCycle = false;
      const visited = new Set<string>();
      while (current && map.has(current)) {
        if (current === u.id || visited.has(current)) {
          isCycle = true;
          break;
        }
        visited.add(current);
        const mgrUser = userById.get(current);
        current = mgrUser?.managerId ?? null;
      }

      if (!isCycle) {
        map.get(u.managerId)!.children.push(node);
      } else {
        roots.push(node);
      }
    } else {
      roots.push(node);
    }
  }

  function sortChildren(n: OrgChartNode): void {
    n.children.sort((a, b) => {
      const at = a.jobTitle ?? "";
      const bt = b.jobTitle ?? "";
      if (at !== bt) return at.localeCompare(bt);
      return a.name.localeCompare(b.name);
    });
    for (const c of n.children) sortChildren(c);
  }
  for (const r of roots) sortChildren(r);

  return roots;
}
