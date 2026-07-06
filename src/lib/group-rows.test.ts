import { describe, it, expect } from "vitest";
import { groupRows, UNGROUPED_LABEL } from "./group-rows";

describe("groupRows", () => {
  const rows = [
    { id: 1, state: "Illinois" },
    { id: 2, state: "california" },
    { id: 3, state: null },
    { id: 4, state: "Illinois" },
    { id: 5, state: "  " },
    { id: 6, state: "Alabama" },
  ];

  it("buckets by key, alphabetically, case-insensitive", () => {
    const groups = groupRows(rows, (r) => r.state);
    expect(groups.map((g) => g.label)).toEqual([
      "Alabama",
      "california",
      "Illinois",
      UNGROUPED_LABEL,
    ]);
  });

  it("puts null/blank keys in a trailing ungrouped bucket", () => {
    const groups = groupRows(rows, (r) => r.state);
    const last = groups[groups.length - 1];
    expect(last.label).toBe(UNGROUPED_LABEL);
    expect(last.rows.map((r) => r.id)).toEqual([3, 5]);
  });

  it("preserves incoming row order within a group", () => {
    const groups = groupRows(rows, (r) => r.state);
    const illinois = groups.find((g) => g.label === "Illinois");
    expect(illinois?.rows.map((r) => r.id)).toEqual([1, 4]);
  });

  it("returns an empty array for no rows", () => {
    expect(groupRows([], () => "x")).toEqual([]);
  });

  it("trims whitespace-padded keys into the same bucket", () => {
    const padded = [
      { id: 1, k: "Chicago" },
      { id: 2, k: " Chicago " },
    ];
    const groups = groupRows(padded, (r) => r.k);
    expect(groups).toHaveLength(1);
    expect(groups[0].rows).toHaveLength(2);
  });
});
