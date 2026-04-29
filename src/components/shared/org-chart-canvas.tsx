"use client";

/**
 * Inner d3-org-chart renderer — kept in its own file so the parent
 * (org-chart-tree.tsx) can lazy-load it via next/dynamic with
 * ssr:false.
 *
 * Why the split: d3-org-chart's `main` field points at a UMD bundle
 * (build/d3-org-chart.min.js) whose top-level wrapper references
 * `this`, which is `undefined` in ESM strict mode. Next.js's server
 * bundling tripped over that and crashed dev / Docker startup when
 * the component was imported directly. Loading this file via
 * next/dynamic({ ssr: false }) keeps d3-org-chart out of the server
 * bundle entirely.
 *
 * Default export is intentional — next/dynamic resolves
 * `.default` from the imported module by convention.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { OrgChart } from "d3-org-chart";

import type { OrgChartNode, OrgChartTreeProps } from "./org-chart-tree";

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

export default function OrgChartCanvas({
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

  // Mount + first render. We instantiate the chart once and call
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
