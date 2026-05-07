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
      // Tag every node as initially expanded so d3-org-chart doesn't
      // hide descendants behind a "click to expand" pager. Real-env
      // QA flagged that on a fresh load only the root tier (TOP OF
      // ORG + immediate children) was visible, and clicking the
      // expand badge on a card was a no-op because d3-org-chart's
      // _expanded flag wasn't set on the data. Setting it here means
      // the chart layout sees the full tree and the .fit() call
      // computes positions for every node — fixing the "Fit to view
      // stacks all cards at one coordinate" symptom too.
      .data(flat.map((n) => ({ ...n, _expanded: true })))
      .nodeWidth(() => 240)
      .nodeHeight(() => 96)
      .childrenMargin(() => 50)
      .siblingsMargin(() => 16)
      .neighbourMargin(() => 40)
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
      .render()
      // Belt and suspenders: call expandAll() after the initial render
      // so any node d3-org-chart auto-collapsed (compact-mode pager,
      // depth limit, etc.) becomes visible. Re-fits to compute
      // coordinates with the full tree expanded.
      .expandAll()
      .fit();
    // Capture the current container element for the cleanup closure —
    // by the time React runs cleanup, containerRef.current has already
    // changed (the lint rule react-hooks/exhaustive-deps catches this).
    const container = containerRef.current;
    return () => {
      // No teardown method on d3-org-chart; emptying the container is
      // enough to drop the SVG / event listeners cleanly.
      if (container) container.innerHTML = "";
      chartRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Push fresh data + highlight on every change without remounting.
  // Same _expanded: true tagging as the mount path — without it, a
  // data refresh (e.g. after editing a card) would re-collapse
  // everything past the root tier.
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    chart
      .data(flat.map((n) => ({ ...n, _expanded: true })))
      .compact(compact)
      .nodeContent((d) => renderCardHtml(d.data, highlightLower))
      .render();
  }, [flat, compact, highlightLower]);

  // Post-render: attach hover listeners to highlight the path of edges
  // from a node up to the root. d3-org-chart doesn't expose an
  // edge-hover hook, but it does emit the chart as a DOM tree of
  // <g class="node"> + <path class="link"> elements with data-bind
  // attributes encoding the parent-child relationship. We walk the
  // DOM after each render, build a parent map by inspecting each
  // path's source/target, then bind mouseenter/leave on every node.
  // On hover we mark the ancestor chain's paths + cards with a
  // `og-highlight` data attribute that the inline CSS below picks up
  // for a quick color flash.
  //
  // Defensive: if d3-org-chart's DOM shape changes in a future
  // version, the selectors return [] and the effect silently no-ops.
  // The chart still works; just the hover-highlight is missing.
  useEffect(() => {
    const root = containerRef.current;
    if (!root) return;

    // Build parent → ancestors map from `flat` so the hover handler
    // doesn't have to walk the DOM at hover time.
    const parentById = new Map<string, string | null>();
    for (const node of flat) {
      parentById.set(node.id, node.parentId);
    }
    function ancestorsOf(id: string): string[] {
      const out: string[] = [];
      let cur = parentById.get(id) ?? null;
      while (cur) {
        out.push(cur);
        cur = parentById.get(cur) ?? null;
      }
      return out;
    }

    // d3-org-chart marks node groups with .node and stores the bound
    // datum on `__data__`; links are <path> elements with class link.
    // We grab everything that smells like a node and walk the bound
    // datum to find the id.
    const nodeEls: HTMLElement[] = [];
    const allNodes = root.querySelectorAll<SVGGElement>("g.node");
    allNodes.forEach((g) => nodeEls.push(g as unknown as HTMLElement));
    const linkEls = root.querySelectorAll<SVGPathElement>("path.link");

    if (nodeEls.length === 0 || linkEls.length === 0) {
      return; // d3-org-chart not rendered (yet) or DOM shape diverged
    }

    // d3 binds its datum on the DOM node itself via the `__data__`
    // property. We read it through a narrow shape rather than `any` so
    // the no-explicit-any rule passes.
    type D3Bound = {
      __data__?: { data?: { id?: unknown }; id?: unknown } | null;
    };
    type D3LinkBound = {
      __data__?: {
        source?: { data?: { id?: unknown }; id?: unknown };
        target?: { data?: { id?: unknown }; id?: unknown };
      } | null;
    };

    function readId(el: Element): string | null {
      // d3-org-chart wraps each node in a hierarchy point, so we look
      // for an inner `data` object first, then fall back to `__data__`
      // itself.
      const bound = (el as unknown as D3Bound).__data__;
      const datum = bound?.data ?? bound;
      if (datum && typeof datum.id === "string") return datum.id;
      return el.getAttribute("data-id");
    }

    // Build a quick lookup from path element → (sourceId, targetId).
    // d3-org-chart's link layout binds the datum {source, target}
    // hierarchy point pair on the path; we read both.
    interface LinkBinding {
      el: SVGPathElement;
      sourceId: string;
      targetId: string;
    }
    const links: LinkBinding[] = [];
    linkEls.forEach((p) => {
      const datum = (p as unknown as D3LinkBound).__data__;
      const sourceId =
        datum?.source?.data?.id ?? datum?.source?.id ?? null;
      const targetId =
        datum?.target?.data?.id ?? datum?.target?.id ?? null;
      if (typeof sourceId === "string" && typeof targetId === "string") {
        links.push({ el: p, sourceId, targetId });
      }
    });

    function setHighlight(activeId: string | null): void {
      if (!activeId) {
        // Clear all
        nodeEls.forEach((n) => n.removeAttribute("data-og-highlight"));
        links.forEach((l) => l.el.removeAttribute("data-og-highlight"));
        return;
      }
      const ancestors = new Set<string>([activeId, ...ancestorsOf(activeId)]);
      nodeEls.forEach((n) => {
        const id = readId(n);
        if (id && ancestors.has(id)) {
          n.setAttribute("data-og-highlight", "true");
        } else {
          n.removeAttribute("data-og-highlight");
        }
      });
      links.forEach((l) => {
        // A link is on the highlighted path if BOTH endpoints are in
        // the ancestor chain from the hovered node up to root.
        if (ancestors.has(l.sourceId) && ancestors.has(l.targetId)) {
          l.el.setAttribute("data-og-highlight", "true");
        } else {
          l.el.removeAttribute("data-og-highlight");
        }
      });
    }

    // Bind handlers + capture cleanup
    const cleanups: Array<() => void> = [];
    nodeEls.forEach((n) => {
      const id = readId(n);
      if (!id || id === VIRTUAL_ROOT_ID) return;
      const onEnter = () => setHighlight(id);
      const onLeave = () => setHighlight(null);
      n.addEventListener("mouseenter", onEnter);
      n.addEventListener("mouseleave", onLeave);
      cleanups.push(() => {
        n.removeEventListener("mouseenter", onEnter);
        n.removeEventListener("mouseleave", onLeave);
      });
    });

    return () => {
      cleanups.forEach((fn) => fn());
      setHighlight(null);
    };
    // Re-run after every chart re-render. flat/compact/highlightLower
    // re-render the chart, replacing the DOM nodes — we re-bind.
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
          title="Expand every node and re-fit to the viewport. If everything is already expanded the tree just re-centers."
        >
          Expand all
        </button>
        <button
          type="button"
          onClick={() => chartRef.current?.collapseAll().fit()}
          className="rounded border border-border px-2 py-1 hover:bg-muted/40 transition-colors"
          title="Collapse every node down to the roots."
        >
          Collapse all
        </button>
        <button
          type="button"
          onClick={() => chartRef.current?.fit()}
          className="rounded border border-border px-2 py-1 hover:bg-muted/40 transition-colors"
          title="Re-center and zoom so the whole tree fits in view."
        >
          Fit to view
        </button>
      </div>
      {/* Inline styles power the hover-highlight effect: when the
       *  hover useEffect adds data-og-highlight to a node group or a
       *  link path, these rules colorize the path from hovered card
       *  up to root. Inline so we don't have to wire a CSS module. */}
      <style>{`
        [data-og-highlight="true"] path.link,
        path.link[data-og-highlight="true"] {
          stroke: var(--primary);
          stroke-width: 2.5;
          opacity: 1;
        }
        path.link {
          transition: stroke 120ms ease, stroke-width 120ms ease, opacity 120ms ease;
        }
        g.node[data-og-highlight="true"] {
          filter: drop-shadow(0 0 0.5rem var(--primary));
        }
      `}</style>
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
