"use client";

import { Avatar } from "@/components/ui/avatar";
import Link from "next/link";
import { ChevronDown, ChevronRight, Pencil, Users } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

/**
 * Scalable org chart.
 *
 * Design choices we've come back to several times — documenting them
 * here so future iterations don't fight the layout:
 *
 *  • Container is a single horizontally + vertically scrollable box.
 *    The inner tree uses `min-width: max-content` so wide trees grow
 *    rather than wrapping awkwardly.
 *  • Connector lines are CSS pseudo-element divs, not SVG. The grid
 *    columns are equal-width per parent so the parent's center aligns
 *    with the midpoint between the leftmost and rightmost child.
 *  • Multi-root scenarios get a synthetic "Top of org" header and the
 *    roots are laid out as siblings under that header — same shape as
 *    any other branch, no special-casing in the renderer.
 *  • Per-node collapse state lives in this component (Set<string>);
 *    children of collapsed nodes don't render so wide subtrees can
 *    be hidden without destroying the layout.
 *  • Search HIGHLIGHTS rather than filters. Filtering destroys the
 *    tree because removing a manager makes their reports orphaned
 *    roots; highlighting keeps the structure intact and shows where
 *    the matches sit.
 *  • Card click opens an editor drawer (parent-supplied callback).
 */

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

interface OrgChartTreeProps {
  nodes: OrgChartNode[];
  /** Highlight cards whose name/jobTitle/department contains this. */
  highlight?: string;
  /** When set, clicking a card calls onCardClick instead of navigating
   *  via the card's `href`. Used by the team page's edit drawer. */
  onCardClick?: (id: string) => void;
  /** Hide the "Top of org" wrapper header when there's only one root. */
  hideTopHeaderForSingleRoot?: boolean;
}

const lineColor = "var(--card-border)";

export function OrgChartTree({
  nodes,
  highlight,
  onCardClick,
  hideTopHeaderForSingleRoot = true,
}: OrgChartTreeProps) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const containerRef = useRef<HTMLDivElement | null>(null);

  // After mount, scroll horizontally to center the chart so the root
  // is visible by default. Without this, very wide trees open with the
  // viewport pinned to the left edge and the user has to hunt for it.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const inner = el.firstElementChild as HTMLElement | null;
    if (!inner) return;
    const overflow = inner.scrollWidth - el.clientWidth;
    if (overflow > 0) {
      el.scrollLeft = overflow / 2;
    }
  }, [nodes]);

  function toggle(id: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const total = useMemo(() => countNodes(nodes), [nodes]);
  const matchCount = useMemo(() => {
    if (!highlight?.trim()) return 0;
    const q = highlight.toLowerCase();
    let n = 0;
    walk(nodes, (node) => {
      if (matchesHighlight(node, q)) n++;
    });
    return n;
  }, [nodes, highlight]);

  if (nodes.length === 0) {
    return <p className="text-sm text-muted-foreground">No team members to display</p>;
  }

  // Single virtual root: when there are multiple top-level people,
  // wrap them under a synthetic "Top of org" node so the renderer
  // doesn't need a special "multiple roots" mode. The synthetic node
  // is unclickable and renders smaller.
  const useVirtualRoot =
    nodes.length > 1 || !hideTopHeaderForSingleRoot;
  const renderable: OrgChartNode = useVirtualRoot
    ? {
        id: "__virtual_root__",
        name: "Top of org",
        children: nodes,
      }
    : nodes[0];

  const totalCollapsed = collapsed.size;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        <span>
          {total} {total === 1 ? "person" : "people"} on the chart
        </span>
        {totalCollapsed > 0 && (
          <button
            type="button"
            onClick={() => setCollapsed(new Set())}
            className="text-primary hover:underline"
          >
            Expand all ({totalCollapsed} collapsed)
          </button>
        )}
        {highlight?.trim() && (
          <span className="ml-auto">
            {matchCount} match{matchCount === 1 ? "" : "es"} for &quot;{highlight}&quot;
          </span>
        )}
      </div>

      <div
        ref={containerRef}
        className="overflow-auto rounded border border-border bg-muted/20 p-6 max-h-[75vh]"
      >
        <div className="w-fit mx-auto" style={{ minWidth: "100%" }}>
          <OrgBranch
            node={renderable}
            isVirtual={renderable.id === "__virtual_root__"}
            collapsed={collapsed}
            onToggle={toggle}
            highlight={highlight?.trim().toLowerCase()}
            onCardClick={onCardClick}
          />
        </div>
      </div>
    </div>
  );
}

// ─── Branch / Card ─────────────────────────────────────────────────────

function OrgBranch({
  node,
  isVirtual,
  collapsed,
  onToggle,
  highlight,
  onCardClick,
}: {
  node: OrgChartNode;
  isVirtual: boolean;
  collapsed: Set<string>;
  onToggle: (id: string) => void;
  highlight?: string;
  onCardClick?: (id: string) => void;
}) {
  const isCollapsed = collapsed.has(node.id);
  const childCount = node.children.length;
  const showChildren = childCount > 0 && !isCollapsed;

  return (
    <div className="flex flex-col items-center">
      {isVirtual ? (
        <VirtualHeader />
      ) : (
        <NodeCard
          node={node}
          highlight={highlight}
          onCardClick={onCardClick}
          collapsed={isCollapsed}
          childCount={childCount}
          onToggle={() => onToggle(node.id)}
        />
      )}

      {showChildren && (
        <>
          <div style={{ width: 1, height: 24, backgroundColor: lineColor }} />
          {childCount === 1 ? (
            <OrgBranch
              node={node.children[0]}
              isVirtual={false}
              collapsed={collapsed}
              onToggle={onToggle}
              highlight={highlight}
              onCardClick={onCardClick}
            />
          ) : (
            <div
              className="grid items-start"
              style={{
                gridTemplateColumns: `repeat(${childCount}, minmax(220px, 1fr))`,
                columnGap: 24,
              }}
            >
              {node.children.map((child, idx) => {
                const isFirst = idx === 0;
                const isLast = idx === childCount - 1;
                return (
                  <div key={child.id} className="flex flex-col items-center min-w-0">
                    {/* Connector segment: horizontal line that links
                        the parent's vertical down-line to this child,
                        plus a short vertical down-line into the child
                        card. */}
                    <div className="self-stretch relative" style={{ height: 24 }}>
                      <div
                        className="absolute top-0"
                        style={{
                          height: 1,
                          backgroundColor: lineColor,
                          left: isFirst ? "50%" : -12,
                          right: isLast ? "50%" : -12,
                        }}
                      />
                      <div
                        className="absolute top-0 left-1/2"
                        style={{
                          width: 1,
                          height: "100%",
                          backgroundColor: lineColor,
                          transform: "translateX(-0.5px)",
                        }}
                      />
                    </div>
                    <OrgBranch
                      node={child}
                      isVirtual={false}
                      collapsed={collapsed}
                      onToggle={onToggle}
                      highlight={highlight}
                      onCardClick={onCardClick}
                    />
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {childCount > 0 && isCollapsed && (
        <button
          type="button"
          onClick={() => onToggle(node.id)}
          className="mt-2 text-[10px] text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
        >
          <ChevronRight className="h-3 w-3" />
          {childCount} hidden
        </button>
      )}
    </div>
  );
}

function VirtualHeader() {
  return (
    <div className="rounded-lg border border-dashed border-border bg-background/50 px-3 py-1.5 text-[10px] uppercase tracking-wide text-muted-foreground inline-flex items-center gap-1.5">
      <Users className="h-3 w-3" />
      Top of org
    </div>
  );
}

function NodeCard({
  node,
  highlight,
  onCardClick,
  collapsed,
  childCount,
  onToggle,
}: {
  node: OrgChartNode;
  highlight?: string;
  onCardClick?: (id: string) => void;
  collapsed: boolean;
  childCount: number;
  onToggle: () => void;
}) {
  const isMatch = highlight ? matchesHighlight(node, highlight) : false;

  const card = (
    <div
      className={`rounded-lg text-left transition-shadow hover:shadow-lg bg-card text-card-foreground shadow-md px-4 py-3 min-w-[200px] max-w-[260px] relative ${
        isMatch ? "ring-2 ring-primary" : ""
      }`}
      style={{ border: "1px solid var(--card-border)" }}
    >
      <div className="flex items-center gap-3">
        <Avatar name={node.name} size="sm" />
        <div className="min-w-0 flex-1">
          <p className="font-semibold truncate text-sm">{node.name}</p>
          {node.jobTitle ? (
            <p className="text-primary/80 font-medium truncate text-xs">
              {node.jobTitle}
            </p>
          ) : (
            <p className="text-muted-foreground italic truncate text-xs">
              No title
            </p>
          )}
          {(node.department || node.location) && (
            <p className="text-[10px] text-muted-foreground truncate">
              {[node.department, node.location].filter(Boolean).join(" · ")}
            </p>
          )}
        </div>
      </div>
      {onCardClick && (
        <span
          className="absolute top-2 right-2 text-muted-foreground/60"
          aria-hidden
        >
          <Pencil className="h-3 w-3" />
        </span>
      )}
    </div>
  );

  // Collapse toggle floats over the bottom of the card so users can
  // hide a manager's subtree without losing access to the card itself.
  const collapseToggle = childCount > 0 ? (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        e.preventDefault();
        onToggle();
      }}
      aria-label={collapsed ? "Expand reports" : "Collapse reports"}
      className="absolute -bottom-2.5 left-1/2 -translate-x-1/2 inline-flex items-center justify-center w-5 h-5 rounded-full bg-background border border-border text-muted-foreground hover:text-foreground hover:border-primary z-10"
    >
      {collapsed ? (
        <ChevronRight className="h-3 w-3" />
      ) : (
        <ChevronDown className="h-3 w-3" />
      )}
    </button>
  ) : null;

  // Click target: prefer onCardClick (edit drawer) over href so the
  // org-chart edit experience doesn't navigate away. The href version
  // remains for legacy use-sites that still want a link.
  const inner = (
    <div className="relative">
      {card}
      {collapseToggle}
    </div>
  );

  if (onCardClick) {
    return (
      <button
        type="button"
        onClick={() => onCardClick(node.id)}
        className="block focus:outline-none focus:ring-2 focus:ring-primary rounded-lg"
      >
        {inner}
      </button>
    );
  }
  if (node.href) {
    return (
      <Link href={node.href} className="block">
        {inner}
      </Link>
    );
  }
  return inner;
}

// ─── Helpers ───────────────────────────────────────────────────────────

function matchesHighlight(node: OrgChartNode, q: string): boolean {
  return (
    node.name.toLowerCase().includes(q) ||
    (node.jobTitle?.toLowerCase().includes(q) ?? false) ||
    (node.department?.toLowerCase().includes(q) ?? false) ||
    (node.location?.toLowerCase().includes(q) ?? false)
  );
}

function countNodes(nodes: OrgChartNode[]): number {
  let n = 0;
  walk(nodes, () => {
    n++;
  });
  return n;
}

function walk(
  nodes: OrgChartNode[],
  fn: (node: OrgChartNode) => void
): void {
  for (const node of nodes) {
    fn(node);
    if (node.children.length > 0) walk(node.children, fn);
  }
}

// ─── Tree builder ──────────────────────────────────────────────────────

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

  // Sort siblings consistently: by jobTitle (managers tend to have
  // titled positions and bubble up) then by name. Avoids the org
  // chart re-shuffling on every re-render.
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
  roots.sort((a, b) => {
    const at = a.jobTitle ?? "";
    const bt = b.jobTitle ?? "";
    if (at !== bt) return at.localeCompare(bt);
    return a.name.localeCompare(b.name);
  });

  return roots;
}
