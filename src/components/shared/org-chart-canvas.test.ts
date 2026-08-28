import { describe, it, expect } from "vitest";
import {
  MIN_FIT_SCALE,
  ORG_CHART_CSS,
  ORG_CHART_DEFAULT_COMPACT,
  ORG_CHART_LAYOUT,
  clampedFitBounds,
  flattenForOrgChart,
  VIRTUAL_ROOT_ID,
} from "./org-chart-canvas";
import type { OrgChartNode } from "./org-chart-tree";

/**
 * Round-5 QA caught org-chart nodes rendering at ~0.24 opacity in
 * the default (resting) state. d3-org-chart's enter/exit
 * transitions set `attr("opacity", …)` inline on every g.node, and
 * an interrupted transition (e.g. a `.fit()` call before a previous
 * one finishes) can leave nodes stuck at an intermediate value. The
 * stylesheet must include a default `g.node { opacity: 1 !important }`
 * rule so the inline residual loses to the stylesheet — and the dim
 * rule must be parent-attr-guarded so it doesn't fire on the
 * resting state.
 *
 * These tests pin both invariants to ORG_CHART_CSS (exported from
 * the canvas component for exactly this reason). If a future edit
 * removes either rule, the test fails before the regression ships.
 */
describe("ORG_CHART_CSS", () => {
  it("forces g.node to full opacity by default with !important", () => {
    // Strip whitespace to make the assertion forgiving of formatting
    // changes; we only care about the rule's presence.
    const compact = ORG_CHART_CSS.replace(/\s+/g, " ");
    expect(compact).toMatch(/g\.node\s*{\s*opacity:\s*1\s*!important\s*;?\s*}/);
  });

  it("guards the dim rule on the parent data-og-has-highlight attribute", () => {
    // The selector must include the SVG-level attribute so dimming
    // is a hover-only effect and never fires at rest.
    expect(ORG_CHART_CSS).toContain("svg[data-og-has-highlight]");
    expect(ORG_CHART_CSS).toContain(":not([data-og-highlight])");
  });

  it("does not contain a bare `g.node { opacity: <0.X> }` rule", () => {
    // Negative assertion: an unguarded dim rule is what caused the
    // round-4-D regression. Catch any future re-addition.
    const compact = ORG_CHART_CSS.replace(/\s+/g, " ");
    // A bare g.node opacity rule is ALLOWED only when the value is 1.
    const matches = compact.match(/(?:^|[\s}])g\.node\s*{[^}]*opacity:\s*([0-9.]+)/g);
    if (!matches) return;
    for (const m of matches) {
      const valueMatch = m.match(/opacity:\s*([0-9.]+)/);
      if (valueMatch) {
        expect(parseFloat(valueMatch[1])).toBe(1);
      }
    }
  });
});

/**
 * Round-10 P0 regression: with `compact: true` and 8 leaf siblings
 * under one parent, d3-org-chart's compact-flex algorithm collapses
 * the leaves to overlapping (x, y) coordinates — at /team this
 * produced a ~120x70 px cluster with 28 pairwise card overlaps.
 * compactMarginPair was bumped from 64 to 290 — that's nodeWidth
 * (240) + 50, the cross-axis gap d3 inserts between the left/right
 * column of compact-flex pairs — so sibling bounding boxes can no
 * longer overlap in compact mode.
 *
 * (R10 also flipped the default to compact OFF as a belt-and-braces
 * measure. The UX audit later measured non-compact as the unusable
 * mode — ~3,450px natural width auto-fit down to ~0.11 scale — so
 * the default is compact ON again, which the margin fix here makes
 * safe. See ORG_CHART_DEFAULT_COMPACT.)
 *
 * These tests pin the margin invariants. If a future edit lowers
 * compactMarginPair below nodeWidth, the test fails before the
 * overlap regression ships.
 */
describe("ORG_CHART_LAYOUT", () => {
  it("compactMarginPair leaves at least nodeWidth + 50 px between sibling pair columns", () => {
    // Two cards in the same compact-pair are positioned at
    //   left.x  = parent.x + 0.25 * (2 * nodeWidth + compactMarginPair)
    //           - compactMarginPair / 4
    //   right.x = parent.x + 0.75 * (2 * nodeWidth + compactMarginPair)
    //           + compactMarginPair / 4
    // The gap between their right/left edges is therefore
    //   (right.x - nodeWidth/2) - (left.x + nodeWidth/2)
    //   = 0.5 * (2*nodeWidth + compactMarginPair)
    //     + compactMarginPair / 2 - nodeWidth
    //   = compactMarginPair
    // i.e. the gap is exactly compactMarginPair. Assert it's at
    // least nodeWidth + 50 so the two cards can never visually
    // merge into one cluster the way they did pre-R10.
    expect(ORG_CHART_LAYOUT.compactMarginPair).toBeGreaterThanOrEqual(
      ORG_CHART_LAYOUT.nodeWidth + 50
    );
  });

  it("compactMarginBetween is positive so stacked rows don't overlap", () => {
    expect(ORG_CHART_LAYOUT.compactMarginBetween).toBeGreaterThan(0);
  });

  it("nodeWidth and nodeHeight are positive", () => {
    expect(ORG_CHART_LAYOUT.nodeWidth).toBeGreaterThan(0);
    expect(ORG_CHART_LAYOUT.nodeHeight).toBeGreaterThan(0);
  });
});

/**
 * UX-audit defect: the default org-chart view was an empty box with a
 * smudge — the non-compact tree lays out ~3,447px wide in an ~822px
 * container, so d3-org-chart's unbounded fit() scaled it to ≈0.107
 * (names at ~1.2px). Two invariants pin the fix:
 *
 *   1. Compact layout defaults ON (readable natural width).
 *   2. Fit-to-view never zooms below MIN_FIT_SCALE — when the clamped
 *      scale can't show everything, the tree is top-aligned and
 *      horizontally centered so pan/scroll reaches the rest.
 */
describe("fit-to-view clamp", () => {
  it("defaults compact layout ON and floors fit at scale 0.5", () => {
    expect(ORG_CHART_DEFAULT_COMPACT).toBe(true);
    expect(MIN_FIT_SCALE).toBe(0.5);
  });

  it("defers to the library fit (null) when the tree fits at or above the floor", () => {
    // 800-unit-wide tree in an 822px viewport → natural scale ≈ 0.9,
    // comfortably above the floor.
    const bounds = clampedFitBounds({
      viewWidth: 822,
      viewHeight: 616,
      minX: -400,
      maxX: 400,
      minY: -50,
      maxY: 450,
    });
    expect(bounds).toBeNull();
  });

  it("clamps the audited 3,447px tree to exactly MIN_FIT_SCALE, top-aligned", () => {
    const view = { viewWidth: 822, viewHeight: 616 };
    const tree = { minX: -1723.5, maxX: 1723.5, minY: -50, maxY: 450 };
    // Sanity: the library's own formula on this tree is the audited smudge.
    const naturalScale = Math.min(
      8,
      0.9 /
        Math.max(
          (tree.maxX - tree.minX) / view.viewWidth,
          (tree.maxY - tree.minY) / view.viewHeight
        )
    );
    expect(naturalScale).toBeLessThan(0.25);

    const bounds = clampedFitBounds({ ...view, ...tree });
    expect(bounds).not.toBeNull();
    const { x0, x1, y0, y1 } = bounds!;

    // zoomTreeBounds applies scale = min(8, 0.9 / max(bw/w, bh/h)) to
    // whatever box it's given — the synthetic box must land it exactly
    // on the floor.
    const appliedScale = Math.min(
      8,
      0.9 /
        Math.max((x1 - x0) / view.viewWidth, (y1 - y0) / view.viewHeight)
    );
    expect(appliedScale).toBeCloseTo(MIN_FIT_SCALE, 6);

    // zoomTreeBounds centers the box midpoint: a chart point p maps to
    // screen h/2 + scale * (p - cy). The tree's top edge (minY) must
    // map to screen y = 0 (top-aligned, no dead band above)…
    const cy = (y0 + y1) / 2;
    const screenYofTreeTop =
      view.viewHeight / 2 + MIN_FIT_SCALE * (tree.minY - cy);
    expect(screenYofTreeTop).toBeCloseTo(0, 6);

    // …and the box midpoint must sit on the tree's horizontal center
    // so the overflow hangs evenly left and right.
    expect((x0 + x1) / 2).toBeCloseTo((tree.minX + tree.maxX) / 2, 6);
  });
});

describe("flattenForOrgChart", () => {
  /**
   * The QA-prescribed fixture: one root + 3 children, each child
   * with 2 grandchildren. 1 + 3 + 6 = 10 nodes.
   */
  function makeFixture(): OrgChartNode[] {
    function leaf(id: string, name: string): OrgChartNode {
      return { id, name, children: [] };
    }
    return [
      {
        id: "root",
        name: "Root",
        children: [
          {
            id: "child-1",
            name: "Child 1",
            children: [leaf("gc-1a", "GC 1a"), leaf("gc-1b", "GC 1b")],
          },
          {
            id: "child-2",
            name: "Child 2",
            children: [leaf("gc-2a", "GC 2a"), leaf("gc-2b", "GC 2b")],
          },
          {
            id: "child-3",
            name: "Child 3",
            children: [leaf("gc-3a", "GC 3a"), leaf("gc-3b", "GC 3b")],
          },
        ],
      },
    ];
  }

  it("flattens a single-root tree without inserting a virtual root when hideTopHeaderForSingleRoot is on", () => {
    const flat = flattenForOrgChart(makeFixture(), true);
    // 1 root + 3 children + 6 grandchildren = 10 — no virtual root.
    expect(flat).toHaveLength(10);
    expect(flat.every((n) => n.id !== VIRTUAL_ROOT_ID)).toBe(true);
    const root = flat.find((n) => n.id === "root");
    expect(root?.parentId).toBeNull();
  });

  it("links each grandchild to its child parent and each child to root", () => {
    const flat = flattenForOrgChart(makeFixture(), true);
    const byId = new Map(flat.map((n) => [n.id, n]));
    expect(byId.get("child-1")?.parentId).toBe("root");
    expect(byId.get("child-2")?.parentId).toBe("root");
    expect(byId.get("child-3")?.parentId).toBe("root");
    expect(byId.get("gc-1a")?.parentId).toBe("child-1");
    expect(byId.get("gc-1b")?.parentId).toBe("child-1");
    expect(byId.get("gc-2a")?.parentId).toBe("child-2");
    expect(byId.get("gc-3b")?.parentId).toBe("child-3");
  });

  it("inserts a virtual root when there are multiple top-level nodes", () => {
    const flat = flattenForOrgChart(
      [
        { id: "a", name: "A", children: [] },
        { id: "b", name: "B", children: [] },
      ],
      true
    );
    expect(flat[0].id).toBe(VIRTUAL_ROOT_ID);
    expect(flat[0].isVirtualRoot).toBe(true);
    // Top-level nodes now point at the virtual root.
    expect(flat.find((n) => n.id === "a")?.parentId).toBe(VIRTUAL_ROOT_ID);
    expect(flat.find((n) => n.id === "b")?.parentId).toBe(VIRTUAL_ROOT_ID);
  });
});
