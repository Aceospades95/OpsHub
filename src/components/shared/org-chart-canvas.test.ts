import { describe, it, expect } from "vitest";
import { ORG_CHART_CSS } from "./org-chart-canvas";

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
