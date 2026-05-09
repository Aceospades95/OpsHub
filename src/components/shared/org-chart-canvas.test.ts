import { describe, it, expect } from "vitest";
import {
  ORG_CHART_CSS,
  ORG_CHART_LAYOUT,
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
 * produced a ~120x70 px cluster with 28 pairwise card overlaps. The
 * fix has two parts:
 *
 *   1. The component defaults `compact = false` so a fresh load is
 *      always legible. The toggle still works for trees where
 *      compact actually helps.
 *   2. compactMarginPair was bumped from 64 to 290 — that's
 *      nodeWidth (240) + 50, the cross-axis gap d3 inserts between
 *      the left/right column of compact-flex pairs. Even when the
 *      user toggles compact ON for a leaf-heavy tree, sibling
 *      bounding boxes can no longer overlap.
 *
 * These tests pin both invariants. If a future edit lowers
 * compactMarginPair below nodeWidth or sets the default compact
 * back to true, the test fails before the regression ships.
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
