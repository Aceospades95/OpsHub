/**
 * buildGoogleTaskTree — pure structure rebuilding for one Google list:
 * "My order" sorting (lexicographic position, nulls last), one-level
 * subtask nesting via bare-id parent matching against composite
 * sourceIds, orphan promotion, and the defensive deep-chain/cycle
 * guards. Plus the shared sourceId parser.
 */
import { describe, it, expect } from "vitest";
import { buildGoogleTaskTree, parseSourceId, type GoogleTreeRow } from "./task-tree";

interface Row extends GoogleTreeRow {
  id: string;
}

/** Row factory — sourceId defaults to the composite "list-a:<id>". */
function row(
  id: string,
  opts: { parent?: string; pos?: string; sourceId?: string | null } = {}
): Row {
  return {
    id,
    sourceId: opts.sourceId !== undefined ? opts.sourceId : `list-a:${id}`,
    googleParentId: opts.parent ?? null,
    googlePosition: opts.pos ?? null,
  };
}

const ids = (nodes: { id: string }[]) => nodes.map((n) => n.id);

describe("buildGoogleTaskTree", () => {
  it("returns an empty tree for no rows", () => {
    expect(buildGoogleTaskTree([])).toEqual([]);
  });

  it("sorts top level by position lexicographically, null positions last in original order", () => {
    const tree = buildGoogleTaskTree([
      row("unpos-1"),
      row("late", { pos: "00000000000000000010" }),
      row("unpos-2"),
      row("early", { pos: "00000000000000000002" }),
    ]);
    // "…002" < "…010" as plain strings; the two unstamped rows trail
    // in the order they came in (stable sort).
    expect(ids(tree)).toEqual(["early", "late", "unpos-1", "unpos-2"]);
    expect(tree.every((n) => n.children.length === 0)).toBe(true);
  });

  it("nests subtasks under their parent, also in position order with nulls last", () => {
    const tree = buildGoogleTaskTree([
      row("c-unpos", { parent: "p1" }),
      row("p2", { pos: "00000000000000000002" }),
      row("c-second", { parent: "p1", pos: "00000000000000000005" }),
      row("p1", { pos: "00000000000000000001" }),
      row("c-first", { parent: "p1", pos: "00000000000000000001" }),
    ]);
    expect(ids(tree)).toEqual(["p1", "p2"]);
    expect(ids(tree[0].children)).toEqual(["c-first", "c-second", "c-unpos"]);
    expect(tree[1].children).toEqual([]);
  });

  it("matches parents by the bare task id inside a composite sourceId", () => {
    // googleParentId stores the BARE Google id; the parent row's
    // sourceId carries the "<tasklistId>:" prefix that must be shed.
    const tree = buildGoogleTaskTree([
      row("parent", { sourceId: "list-a:parent" }),
      row("child", { parent: "parent" }),
    ]);
    expect(ids(tree)).toEqual(["parent"]);
    expect(ids(tree[0].children)).toEqual(["child"]);
  });

  it("matches parents with a legacy bare sourceId (no list prefix)", () => {
    const tree = buildGoogleTaskTree([
      row("legacy", { sourceId: "legacy" }),
      row("child", { parent: "legacy" }),
    ]);
    expect(ids(tree)).toEqual(["legacy"]);
    expect(ids(tree[0].children)).toEqual(["child"]);
  });

  it("promotes orphans (parent row missing) to top level instead of dropping them", () => {
    // The parent was completed/deleted/never synced — its subtask must
    // still render. A null-sourceId row can't anchor children either.
    const tree = buildGoogleTaskTree([
      row("orphan", { parent: "not-here", pos: "00000000000000000001" }),
      row("no-source", { parent: "also-gone", sourceId: null }),
      row("normal", { pos: "00000000000000000002" }),
    ]);
    expect(ids(tree)).toEqual(["orphan", "normal", "no-source"]);
  });

  it("flattens a deeper-than-Google chain under the top-level ancestor", () => {
    // Google only allows one level; if deeper data ever appears the
    // grandchild attaches to the top ancestor rather than vanishing.
    const tree = buildGoogleTaskTree([
      row("top"),
      row("mid", { parent: "top", pos: "00000000000000000001" }),
      row("deep", { parent: "mid", pos: "00000000000000000002" }),
    ]);
    expect(ids(tree)).toEqual(["top"]);
    expect(ids(tree[0].children)).toEqual(["mid", "deep"]);
  });

  it("breaks cycle members out to top level (nothing dropped, nothing loops)", () => {
    const tree = buildGoogleTaskTree([
      row("a", { parent: "b", pos: "00000000000000000002" }),
      row("b", { parent: "a", pos: "00000000000000000001" }),
      row("self", { parent: "self", pos: "00000000000000000003" }),
    ]);
    expect(ids(tree)).toEqual(["b", "a", "self"]);
    expect(tree.every((n) => n.children.length === 0)).toBe(true);
  });
});

describe("parseSourceId", () => {
  it("splits a composite key into list + task", () => {
    expect(parseSourceId("list-a:g1")).toEqual({ tasklistId: "list-a", taskId: "g1" });
  });

  it("treats a bare legacy id as having no list", () => {
    expect(parseSourceId("g1")).toEqual({ tasklistId: null, taskId: "g1" });
  });

  it("splits on the FIRST colon only — task ids keep any later ones", () => {
    expect(parseSourceId("list:a:b")).toEqual({ tasklistId: "list", taskId: "a:b" });
  });
});
