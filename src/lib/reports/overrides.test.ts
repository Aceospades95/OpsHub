import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock Prisma + the logger before importing the module under test so
// the static `import { db } from "@/lib/db"` picks up the mock and the
// deliberate error-path tests don't spam the console.
vi.mock("@/lib/db", () => ({
  db: {
    reportOverride: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
    },
  },
}));
vi.mock("@/lib/log", () => ({
  log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { db } from "@/lib/db";
import { log } from "@/lib/log";
import type { ReportOutput } from "./types";
import {
  applyReportOverride,
  getAllReportOverrides,
  getReportOverride,
  parseColumnConfig,
  type ReportOverrideData,
} from "./overrides";

const findUnique = db.reportOverride.findUnique as ReturnType<typeof vi.fn>;
const findMany = db.reportOverride.findMany as ReturnType<typeof vi.fn>;

/** Fresh three-column / three-row output for every test. */
function baseOutput(): ReportOutput {
  return {
    summary: "3 things found",
    columns: [
      { key: "a", label: "Alpha" },
      { key: "b", label: "Beta" },
      { key: "c", label: "Gamma" },
    ],
    rows: [
      { a: 1, b: "x", c: true },
      { a: 2, b: "y", c: false },
      { a: 3, b: "z", c: null },
    ],
    emptyMessage: "Nothing here",
  };
}

/** Build a full ReportOverrideData from a partial. */
function ov(partial: Partial<ReportOverrideData>): ReportOverrideData {
  return {
    displayName: null,
    description: null,
    hidden: false,
    maxRows: null,
    columnConfig: null,
    ...partial,
  };
}

// ─── parseColumnConfig ─────────────────────────────────────────

describe("parseColumnConfig", () => {
  it("returns null for null / undefined / primitives", () => {
    expect(parseColumnConfig(null)).toBeNull();
    expect(parseColumnConfig(undefined)).toBeNull();
    expect(parseColumnConfig("")).toBeNull();
    expect(parseColumnConfig('{"a":{"hidden":true}}')).toBeNull(); // strings are NOT parsed as JSON
    expect(parseColumnConfig(42)).toBeNull();
    expect(parseColumnConfig(true)).toBeNull();
  });

  it("returns null for arrays (top-level config must be an object)", () => {
    expect(parseColumnConfig([])).toBeNull();
    expect(parseColumnConfig([{ label: "X" }])).toBeNull();
  });

  it("keeps a fully valid entry as-is (trimmed label)", () => {
    expect(
      parseColumnConfig({ a: { label: "  Renamed  ", hidden: true, order: 2 } })
    ).toEqual({ a: { label: "Renamed", hidden: true, order: 2 } });
  });

  it("skips entries whose value is not a plain object", () => {
    expect(
      parseColumnConfig({
        a: "nope",
        b: 42,
        c: null,
        d: ["array"],
        e: { label: "Kept" },
      })
    ).toEqual({ e: { label: "Kept" } });
  });

  it("drops non-string and whitespace-only labels", () => {
    expect(parseColumnConfig({ a: { label: 7 } })).toBeNull();
    expect(parseColumnConfig({ a: { label: "   " } })).toBeNull();
    expect(parseColumnConfig({ a: { label: "" } })).toBeNull();
    // label invalid but hidden valid → entry survives with just hidden
    expect(parseColumnConfig({ a: { label: "  ", hidden: true } })).toEqual({
      a: { hidden: true },
    });
  });

  it("slices labels longer than 120 chars (after trimming)", () => {
    const long = ` ${"x".repeat(150)} `;
    const parsed = parseColumnConfig({ a: { label: long } });
    expect(parsed?.a.label).toBe("x".repeat(120));
    expect(parsed?.a.label).toHaveLength(120);
  });

  it("drops non-boolean hidden values, keeps explicit false", () => {
    expect(parseColumnConfig({ a: { hidden: "yes" } })).toBeNull();
    expect(parseColumnConfig({ a: { hidden: 1 } })).toBeNull();
    expect(parseColumnConfig({ a: { hidden: false } })).toEqual({
      a: { hidden: false },
    });
  });

  it("drops NaN / Infinity / string orders, keeps 0 / negative / float", () => {
    expect(parseColumnConfig({ a: { order: NaN } })).toBeNull();
    expect(parseColumnConfig({ a: { order: Infinity } })).toBeNull();
    expect(parseColumnConfig({ a: { order: -Infinity } })).toBeNull();
    expect(parseColumnConfig({ a: { order: "2" } })).toBeNull();
    expect(parseColumnConfig({ a: { order: 0 } })).toEqual({ a: { order: 0 } });
    expect(parseColumnConfig({ a: { order: -3 } })).toEqual({ a: { order: -3 } });
    expect(parseColumnConfig({ a: { order: 1.5 } })).toEqual({ a: { order: 1.5 } });
  });

  it("omits entries that end up empty and nulls a config that ends up empty", () => {
    // b's fields are all invalid → b omitted, a survives
    expect(
      parseColumnConfig({
        a: { hidden: true },
        b: { label: 9, hidden: "x", order: NaN },
      })
    ).toEqual({ a: { hidden: true } });
    // every entry invalid → whole config is null
    expect(
      parseColumnConfig({ a: { label: 9 }, b: { order: "x" }, c: {} })
    ).toBeNull();
  });

  it("ignores unknown extra fields on an entry", () => {
    expect(
      parseColumnConfig({ a: { label: "X", width: 200, align: "left" } })
    ).toEqual({ a: { label: "X" } });
  });
});

// ─── applyReportOverride ───────────────────────────────────────

describe("applyReportOverride", () => {
  it("returns the exact same output reference for a null override", () => {
    const output = baseOutput();
    expect(applyReportOverride(output, null)).toBe(output);
  });

  it("is a no-op (deep-equal) for an override with all-null fields", () => {
    const output = baseOutput();
    const result = applyReportOverride(output, ov({}));
    expect(result).toEqual(output);
    // Rows aren't re-projected when no column is hidden.
    expect(result.rows).toBe(output.rows);
    expect(result.emptyMessage).toBe("Nothing here");
  });

  it("does not mutate its input (pure)", () => {
    const output = baseOutput();
    const snapshot = structuredClone(output);
    applyReportOverride(
      output,
      ov({
        maxRows: 1,
        columnConfig: {
          a: { label: "Aye", order: 5 },
          b: { hidden: true },
          c: { order: -1 },
        },
      })
    );
    expect(output).toEqual(snapshot);
  });

  describe("label overrides", () => {
    it("relabels a single column and leaves the others untouched (same refs)", () => {
      const output = baseOutput();
      const result = applyReportOverride(
        output,
        ov({ columnConfig: { b: { label: "Bee" } } })
      );
      expect(result.columns.map((c) => c.label)).toEqual(["Alpha", "Bee", "Gamma"]);
      expect(result.columns.map((c) => c.key)).toEqual(["a", "b", "c"]);
      expect(result.columns[0]).toBe(output.columns[0]);
      expect(result.columns[2]).toBe(output.columns[2]);
    });

    it("relabels several columns at once", () => {
      const result = applyReportOverride(
        baseOutput(),
        ov({ columnConfig: { a: { label: "One" }, c: { label: "Three" } } })
      );
      expect(result.columns.map((c) => c.label)).toEqual(["One", "Beta", "Three"]);
    });

    it("preserves format/align on a relabeled column", () => {
      const output = baseOutput();
      const format = (v: unknown) => `#${v}`;
      output.columns[0] = { key: "a", label: "Alpha", format, align: "right" };
      const result = applyReportOverride(
        output,
        ov({ columnConfig: { a: { label: "Aye" } } })
      );
      expect(result.columns[0].label).toBe("Aye");
      expect(result.columns[0].format).toBe(format);
      expect(result.columns[0].align).toBe("right");
    });

    it("ignores a label for an unknown column key without crashing", () => {
      const output = baseOutput();
      const result = applyReportOverride(
        output,
        ov({ columnConfig: { zzz: { label: "Ghost" } } })
      );
      expect(result.columns).toEqual(output.columns);
      expect(result.rows).toEqual(output.rows);
    });

    it("treats an empty-string label (bypassing parseColumnConfig) as no relabel", () => {
      const result = applyReportOverride(
        baseOutput(),
        ov({ columnConfig: { a: { label: "" } } })
      );
      expect(result.columns[0].label).toBe("Alpha");
    });
  });

  describe("hidden columns", () => {
    it("removes a hidden column from headers AND from every row object", () => {
      const result = applyReportOverride(
        baseOutput(),
        ov({ columnConfig: { b: { hidden: true } } })
      );
      expect(result.columns.map((c) => c.key)).toEqual(["a", "c"]);
      for (const row of result.rows) {
        expect(Object.keys(row)).toEqual(["a", "c"]);
        expect(row).not.toHaveProperty("b");
      }
      // falsy-but-real values survive the re-projection
      expect(result.rows[1].c).toBe(false);
      expect(result.rows[2].c).toBeNull();
      expect(result.rows.map((r) => r.a)).toEqual([1, 2, 3]);
    });

    it("hidden column values never leak through JSON serialization of rows", () => {
      const result = applyReportOverride(
        baseOutput(),
        ov({ columnConfig: { b: { hidden: true } } })
      );
      expect(JSON.stringify(result.rows)).not.toContain('"b"');
      expect(JSON.stringify(result.rows)).not.toContain('"x"');
    });

    it("hides multiple columns, leaving one", () => {
      const result = applyReportOverride(
        baseOutput(),
        ov({ columnConfig: { a: { hidden: true }, c: { hidden: true } } })
      );
      expect(result.columns.map((c) => c.key)).toEqual(["b"]);
      expect(result.rows).toEqual([{ b: "x" }, { b: "y" }, { b: "z" }]);
    });

    it("ignores visibility entirely when the config would hide EVERY column", () => {
      const output = baseOutput();
      const result = applyReportOverride(
        output,
        ov({
          columnConfig: {
            a: { hidden: true },
            b: { hidden: true },
            c: { hidden: true },
          },
        })
      );
      expect(result.columns.map((c) => c.key)).toEqual(["a", "b", "c"]);
      // rows untouched (same reference — no re-projection happened)
      expect(result.rows).toBe(output.rows);
    });

    it("still applies labels and order in the all-hidden case", () => {
      const result = applyReportOverride(
        baseOutput(),
        ov({
          columnConfig: {
            a: { hidden: true, label: "Aye" },
            b: { hidden: true, order: -1 },
            c: { hidden: true },
          },
        })
      );
      expect(result.columns.map((c) => c.key)).toEqual(["b", "a", "c"]);
      expect(result.columns.find((c) => c.key === "a")?.label).toBe("Aye");
    });

    it("keeps a column with an explicit hidden:false", () => {
      const result = applyReportOverride(
        baseOutput(),
        ov({ columnConfig: { a: { hidden: false }, b: { hidden: true } } })
      );
      expect(result.columns.map((c) => c.key)).toEqual(["a", "c"]);
    });

    it("hiding an unknown key hides nothing", () => {
      const output = baseOutput();
      const result = applyReportOverride(
        output,
        ov({ columnConfig: { nope: { hidden: true } } })
      );
      expect(result.columns).toHaveLength(3);
      expect(result.rows).toBe(output.rows);
    });
  });

  describe("column order", () => {
    it("reorders columns by explicit order values", () => {
      const result = applyReportOverride(
        baseOutput(),
        ov({ columnConfig: { a: { order: 3 }, b: { order: 2 }, c: { order: 1 } } })
      );
      expect(result.columns.map((c) => c.key)).toEqual(["c", "b", "a"]);
    });

    it("breaks sortKey ties by original index (stable)", () => {
      // a: no order → sortKey = index 0; c: order 0 → ties with a; a wins on index.
      const result = applyReportOverride(
        baseOutput(),
        ov({ columnConfig: { c: { order: 0 } } })
      );
      expect(result.columns.map((c) => c.key)).toEqual(["a", "c", "b"]);
    });

    it("keeps original relative order for equal explicit orders", () => {
      const result = applyReportOverride(
        baseOutput(),
        ov({ columnConfig: { a: { order: 5 }, b: { order: 5 } } })
      );
      // c has no order → sortKey 2, sorts before the two 5s; a before b by index.
      expect(result.columns.map((c) => c.key)).toEqual(["c", "a", "b"]);
    });

    it("uses the original index as sortKey for columns without an order", () => {
      const result = applyReportOverride(
        baseOutput(),
        ov({ columnConfig: { b: { order: -1 } } })
      );
      expect(result.columns.map((c) => c.key)).toEqual(["b", "a", "c"]);
    });

    it("supports float orders interleaving with index-derived keys", () => {
      const result = applyReportOverride(
        baseOutput(),
        ov({ columnConfig: { c: { order: 0.5 } } })
      );
      // sortKeys: a=0, c=0.5, b=1
      expect(result.columns.map((c) => c.key)).toEqual(["a", "c", "b"]);
    });

    it("an order on a hidden column has no effect (column already removed)", () => {
      const result = applyReportOverride(
        baseOutput(),
        ov({ columnConfig: { a: { hidden: true, order: 99 }, c: { order: -5 } } })
      );
      expect(result.columns.map((c) => c.key)).toEqual(["c", "b"]);
      expect(result.rows[0]).toEqual({ b: "x", c: true });
    });
  });

  describe("combined label + hidden + order", () => {
    it("hidden wins over label/order on the same column", () => {
      const result = applyReportOverride(
        baseOutput(),
        ov({ columnConfig: { b: { label: "Bee", hidden: true, order: 0 } } })
      );
      expect(result.columns.map((c) => c.key)).toEqual(["a", "c"]);
      expect(result.columns.some((c) => c.label === "Bee")).toBe(false);
      expect(result.rows[0]).not.toHaveProperty("b");
    });

    it("label on one + hide another + reorder a third all compose", () => {
      const result = applyReportOverride(
        baseOutput(),
        ov({
          columnConfig: {
            a: { label: "Aye" },
            b: { hidden: true },
            c: { order: -1 },
          },
        })
      );
      expect(result.columns.map((c) => c.key)).toEqual(["c", "a"]);
      expect(result.columns.map((c) => c.label)).toEqual(["Gamma", "Aye"]);
      expect(result.rows).toEqual([
        { a: 1, c: true },
        { a: 2, c: false },
        { a: 3, c: null },
      ]);
    });
  });

  describe("maxRows", () => {
    it("truncates and appends the summary suffix when rows exceed the cap", () => {
      const result = applyReportOverride(baseOutput(), ov({ maxRows: 2 }));
      expect(result.rows).toHaveLength(2);
      expect(result.rows).toEqual([
        { a: 1, b: "x", c: true },
        { a: 2, b: "y", c: false },
      ]);
      expect(result.summary).toBe(
        "3 things found · showing first 2 of 3 rows (display cap)"
      );
    });

    it("does not truncate or annotate when rows.length equals the cap", () => {
      const result = applyReportOverride(baseOutput(), ov({ maxRows: 3 }));
      expect(result.rows).toHaveLength(3);
      expect(result.summary).toBe("3 things found");
    });

    it("does not truncate when rows.length is under the cap", () => {
      const result = applyReportOverride(baseOutput(), ov({ maxRows: 10 }));
      expect(result.rows).toHaveLength(3);
      expect(result.summary).toBe("3 things found");
    });

    it("treats null / 0 / negative caps as no cap", () => {
      expect(applyReportOverride(baseOutput(), ov({ maxRows: null })).rows).toHaveLength(3);
      expect(applyReportOverride(baseOutput(), ov({ maxRows: 0 })).rows).toHaveLength(3);
      expect(applyReportOverride(baseOutput(), ov({ maxRows: -2 })).rows).toHaveLength(3);
      expect(applyReportOverride(baseOutput(), ov({ maxRows: 0 })).summary).toBe(
        "3 things found"
      );
    });

    it("truncates a cap of 1 to exactly the first row", () => {
      const result = applyReportOverride(baseOutput(), ov({ maxRows: 1 }));
      expect(result.rows).toEqual([{ a: 1, b: "x", c: true }]);
      expect(result.summary).toContain("showing first 1 of 3 rows");
    });

    it("composes with hidden columns: truncated rows are the re-projected ones", () => {
      const result = applyReportOverride(
        baseOutput(),
        ov({ maxRows: 1, columnConfig: { b: { hidden: true } } })
      );
      expect(result.rows).toEqual([{ a: 1, c: true }]);
      // Hiding a column doesn't change the row count in the suffix.
      expect(result.summary).toBe(
        "3 things found · showing first 1 of 3 rows (display cap)"
      );
    });

    it("preserves emptyMessage through truncation", () => {
      const result = applyReportOverride(baseOutput(), ov({ maxRows: 1 }));
      expect(result.emptyMessage).toBe("Nothing here");
    });
  });
});

// ─── getReportOverride (db-backed) ─────────────────────────────

describe("getReportOverride", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("maps a db row to ReportOverrideData with parsed columnConfig", async () => {
    findUnique.mockResolvedValue({
      reportKey: "project-status",
      displayName: "Projects (custom)",
      description: "Renamed",
      hidden: true,
      maxRows: 25,
      columnConfig: { a: { hidden: true, label: "  A  " }, junk: "skip" },
    });
    const result = await getReportOverride("project-status");
    expect(findUnique).toHaveBeenCalledWith({
      where: { reportKey: "project-status" },
    });
    expect(result).toEqual({
      displayName: "Projects (custom)",
      description: "Renamed",
      hidden: true,
      maxRows: 25,
      columnConfig: { a: { hidden: true, label: "A" } },
    });
  });

  it("degrades an unparseable columnConfig to null without dropping the row", async () => {
    findUnique.mockResolvedValue({
      reportKey: "x",
      displayName: "Custom",
      description: null,
      hidden: false,
      maxRows: null,
      columnConfig: "{not json}",
    });
    const result = await getReportOverride("x");
    expect(result?.displayName).toBe("Custom");
    expect(result?.columnConfig).toBeNull();
  });

  it("returns null when no override row exists", async () => {
    findUnique.mockResolvedValue(null);
    expect(await getReportOverride("x")).toBeNull();
  });

  it("returns null (never throws) when the lookup fails", async () => {
    findUnique.mockRejectedValue(new Error("db down"));
    expect(await getReportOverride("x")).toBeNull();
    expect(log.error).toHaveBeenCalledOnce();
  });
});

// ─── getAllReportOverrides ─────────────────────────────────────

describe("getAllReportOverrides", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns a Map keyed by reportKey with parsed configs", async () => {
    findMany.mockResolvedValue([
      {
        reportKey: "one",
        displayName: "One!",
        description: null,
        hidden: false,
        maxRows: 5,
        columnConfig: { k: { order: 1 } },
      },
      {
        reportKey: "two",
        displayName: null,
        description: "d",
        hidden: true,
        maxRows: null,
        columnConfig: null,
      },
    ]);
    const map = await getAllReportOverrides();
    expect(map.size).toBe(2);
    expect(map.get("one")).toEqual({
      displayName: "One!",
      description: null,
      hidden: false,
      maxRows: 5,
      columnConfig: { k: { order: 1 } },
    });
    expect(map.get("two")?.hidden).toBe(true);
    expect(map.get("two")?.columnConfig).toBeNull();
  });

  it("returns an empty Map when the bulk lookup fails", async () => {
    findMany.mockRejectedValue(new Error("db down"));
    const map = await getAllReportOverrides();
    expect(map).toBeInstanceOf(Map);
    expect(map.size).toBe(0);
    expect(log.error).toHaveBeenCalledOnce();
  });

  it("returns an empty Map for zero rows", async () => {
    findMany.mockResolvedValue([]);
    expect((await getAllReportOverrides()).size).toBe(0);
  });
});
