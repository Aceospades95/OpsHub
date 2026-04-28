"use client";

/**
 * OrgChartTree — production-grade org chart powered by d3-org-chart.
 *
 * Why d3-org-chart instead of a custom layout:
 *   • Pan + zoom canvas (Figma-style) is built in. The previous
 *     bespoke component scrolled horizontally only and broke past
 *     5-ish siblings — see the "huge mess with cards stacking" report.
 *   • Compact mode is built in: deep/wide branches automatically stack
 *     vertically with the connector line moving to the side, exactly
 *     the layout we wanted for high-fanout roots.
 *   • Click-to-collapse / search highlighting / responsive resize all
 *     ship out of the box; the previous component reimplemented these
 *     by hand.
 *
 * Public API is unchanged: callers still pass `nodes` (a tree of
 * OrgChartNode) and optional `highlight` / `onCardClick` /
 * `hideTopHeaderForSingleRoot`. Internally we flatten the tree to the
 * { id, parentId, ... } shape d3-org-chart expects, optionally
 * prepending a synthetic "Top of org" root when there are multiple
 * top-level users.
 *
 * Card markup is rendered as an HTML string via .nodeContent() — this
 * is the only API d3-org-chart offers for custom node visuals. We
 * keep the dark-theme card design close to the previous component so
 * the visual change is layout-only.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { OrgChart } from "d3-org-chart";

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

interface FlatNode {
  id: string;
  parentId: string | null;
  name: string;
  jobTitle?: string;
  department?: string;
  location?: string;
  avatar?: string | null;
  href?: string;
  /** True for the synthetic "Top of org" wrapper, rendered differently. */
  isVirtualRoot?: boolean;
  /** Lowercased blob used for the search-highlight check at render time. */
  searchBlob: string;
}

const VIRTUAL_ROOT_ID = "__virtual_root__";

export function OrgChartTree({
  nodes,
  highlight,
  onCardClick,
  hideTopHeaderForSingleRoot = true,
}: OrgChartTreeProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<OrgChart<FlatNode> | null>(null);
  const onCardClickRef = useRef(onCardClick);
  const [compact, setCompact] = useState(true);

  // Keep the latest onCardClick reachable from the chart's own click
  // handler without re-instantiating the chart. d3-org-chart isn't a
  // React component, so prop changes don't otherwise propagate.
  useEffect(() => {
    onCardClickRef.current = onCardClick;
  }, [onCardClick]);

  const flat = useMemo<FlatNode[]>(() => {
    return flattenForOrgChart(nodes, hideTopHeaderForSingleRoot);
  }, [nodes, hideTopHeaderForSingleRoot]);

  // Re-derive the highlight on every render — d3-org-chart re-runs
  // the node template, which reads the closure value.
  const highlightLower = (highlight ?? "").trim().toLowerCase();

  // Mount + data updates. We instantiate the chart once and call
  // .data().render() on subsequent updates so the pan/zoom state and
  // collapsed-node set are preserved across re-renders.
  useEffect(() => {
    if (!containerRef.current) return;
    if (!chartRef.current) {
      chartRef.current = new OrgChart<FlatNode>();
    }
    const chart = chartRef.current;
    chart
      .container(containerRef.current as unknown as string)
      .data(flat)
      .nodeWidth(() => 240)
      .nodeHeight(() => 96)
      .childrenMargin(() => 50)
      .siblingsMargin(() => 16)
      .neighbourMargin(() => 16)
      .compactMarginBetween(() => 16)
      .compactMarginPair(() => 64)
      .compact(compact)
      .nodeContent((d) => renderCardHtml(d.data, highlightLower))
      .onNodeClick((nodeOrId) => {
        // Library typing changed across versions: callback receives
        // either the raw id (older releases) or the full node object
        // (newer ones). Normalize both shapes.
        const id =
          typeof nodeOrId === "string"
            ? nodeOrId
            : (nodeOrId as { data?: FlatNode })?.data?.id;
        if (!id || id === VIRTUAL_ROOT_ID) return;
        const cb = onCardClickRef.current;
        if (cb) {
          cb(id);
          return;
        }
        const target = flat.find((f) => f.id === id);
        if (target?.href) {
          window.location.href = target.href;
        }
      })
      .render();
    return () => {
      // No teardown method on d3-org-chart; emptying the container is
      // enough to drop the SVG / event listeners cleanly.
      if (containerRef.current) containerRef.current.innerHTML = "";
      chartRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Push fresh data + highlight on every change without remounting.
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    chart
      .data(flat)
      .compact(compact)
      .nodeContent((d) => renderCardHtml(d.data, highlightLower))
      .render();
  }, [flat, compact, highlightLower]);

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span>
          {flat.filter((n) => !n.isVirtualRoot).length} team member
          {flat.filter((n) => !n.isVirtualRoot).length === 1 ? "" : "s"} ·
          drag to pan, scroll to zoom, click a card to edit.
        </span>
        <div className="flex-1" />
        <button
          type="button"
          onClick={() => setCompact((v) => !v)}
          className="rounded border border-border px-2 py-1 hover:bg-muted/40 transition-colors"
          title="Compact mode stacks deep branches vertically with a side connector — best for org charts with many siblings."
        >
          {compact ? "Compact layout: ON" : "Compact layout: OFF"}
        </button>
        <button
          type="button"
          onClick={() => chartRef.current?.expandAll().fit()}
          className="rounded border border-border px-2 py-1 hover:bg-muted/40 transition-colors"
        >
          Expand all
        </button>
        <button
          type="button"
          onClick={() => chartRef.current?.collapseAll().fit()}
          className="rounded border border-border px-2 py-1 hover:bg-muted/40 transition-colors"
        >
          Collapse all
        </button>
        <button
          type="button"
          onClick={() => chartRef.current?.fit()}
          className="rounded border border-border px-2 py-1 hover:bg-muted/40 transition-colors"
        >
          Fit to view
        </button>
      </div>
      <div
        ref={containerRef}
        className="rounded border border-border bg-muted/20"
        style={{ height: "75vh", width: "100%" }}
      />
    </div>
  );
}

// ─── Card HTML renderer ──────────────────────────────────────────────────

function renderCardHtml(node: FlatNode, highlightLower: string): string {
  if (node.isVirtualRoot) {
    return `<div style="display:flex;align-items:center;justify-content:center;width:100%;height:100%;border:1px dashed var(--border);border-radius:8px;color:var(--muted-foreground);font-size:11px;text-transform:uppercase;letter-spacing:0.08em;">Top of org</div>`;
  }
  const isHit =
    highlightLower.length > 0 && node.searchBlob.includes(highlightLower);
  const ringColor = isHit ? "var(--primary)" : "var(--border)";
  const initials = node.name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase() ?? "")
    .join("");
  const subline = [node.department, node.location].filter(Boolean).join(" · ");
  return `
    <div style="
      box-sizing:border-box;
      width:100%;
      height:100%;
      padding:12px 14px;
      border:1px solid ${ringColor};
      border-radius:8px;
      background:var(--card);
      color:var(--card-foreground);
      display:flex;
      align-items:center;
      gap:12px;
      cursor:pointer;
      box-shadow:${isHit ? "0 0 0 2px var(--primary)" : "none"};
    ">
      <div style="
        width:40px;height:40px;border-radius:50%;
        background:var(--primary);
        color:var(--primary-foreground);
        display:flex;align-items:center;justify-content:center;
        font-size:13px;font-weight:600;flex-shrink:0;
      ">${escapeHtml(initials)}</div>
      <div style="min-width:0;flex:1;">
        <div style="font-weight:600;font-size:13px;line-height:1.2;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(node.name)}</div>
        ${
          node.jobTitle
            ? `<div style="font-size:12px;color:var(--primary);font-weight:500;line-height:1.3;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(node.jobTitle)}</div>`
            : `<div style="font-size:11px;color:var(--muted-foreground);font-style:italic;">No title</div>`
        }
        ${
          subline
            ? `<div style="font-size:10px;color:var(--muted-foreground);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(subline)}</div>`
            : ""
        }
      </div>
    </div>
  `;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ─── Tree → flat conversion ──────────────────────────────────────────────

function flattenForOrgChart(
  nodes: OrgChartNode[],
  hideTopHeaderForSingleRoot: boolean
): FlatNode[] {
  const useVirtualRoot = nodes.length > 1 || !hideTopHeaderForSingleRoot;

  const out: FlatNode[] = [];

  if (useVirtualRoot) {
    out.push({
      id: VIRTUAL_ROOT_ID,
      parentId: null,
      name: "Top of org",
      isVirtualRoot: true,
      searchBlob: "",
    });
  }

  function walk(node: OrgChartNode, parentId: string | null): void {
    out.push({
      id: node.id,
      parentId,
      name: node.name,
      jobTitle: node.jobTitle,
      department: node.department,
      location: node.location,
      avatar: node.avatar,
      href: node.href,
      searchBlob: [node.name, node.jobTitle, node.department, node.location]
        .filter(Boolean)
        .join(" ")
        .toLowerCase(),
    });
    for (const child of node.children) {
      walk(child, node.id);
    }
  }

  for (const root of nodes) {
    walk(root, useVirtualRoot ? VIRTUAL_ROOT_ID : null);
  }

  return out;
}

// ─── Tree builder (unchanged public API) ─────────────────────────────────

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
