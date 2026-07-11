import { describe, it, expect } from "vitest";

import {
  applyMode,
  mergeFillBlanks,
  isBlank,
  buildResult,
  addWarning,
  warnList,
} from "./helpers";
import type { ImportRowResult } from "./types";

describe("applyMode", () => {
  it("create: skips matches, creates non-matches", () => {
    expect(applyMode("existing-id", "create")).toBe("skip");
    expect(applyMode(null, "create")).toBe("create");
  });

  it("update: updates matches, skips non-matches", () => {
    expect(applyMode("existing-id", "update")).toBe("update");
    expect(applyMode(null, "update")).toBe("skip");
    expect(applyMode(undefined, "update")).toBe("skip");
  });

  it("upsert: updates matches, creates non-matches", () => {
    expect(applyMode({ id: "x" }, "upsert")).toBe("update");
    expect(applyMode(null, "upsert")).toBe("create");
  });

  it("fill-blanks: updates matches, creates non-matches", () => {
    expect(applyMode("existing-id", "fill-blanks")).toBe("update");
    expect(applyMode(null, "fill-blanks")).toBe("create");
  });

  it("defaults to create mode when mode is undefined", () => {
    expect(applyMode("existing-id", undefined)).toBe("skip");
    expect(applyMode(null, undefined)).toBe("create");
  });
});

describe("isBlank", () => {
  it("treats null/undefined/whitespace strings/empty arrays as blank", () => {
    expect(isBlank(null)).toBe(true);
    expect(isBlank(undefined)).toBe(true);
    expect(isBlank("")).toBe(true);
    expect(isBlank("   ")).toBe(true);
    expect(isBlank([])).toBe(true);
  });

  it("treats numbers (incl. 0), booleans, dates, and non-empty values as data", () => {
    expect(isBlank(0)).toBe(false);
    expect(isBlank(false)).toBe(false);
    expect(isBlank(new Date())).toBe(false);
    expect(isBlank("x")).toBe(false);
    expect(isBlank(["a"])).toBe(false);
  });
});

describe("mergeFillBlanks", () => {
  it("fills only fields that are blank on the existing record", () => {
    const existing = {
      name: "Acme",
      industry: null,
      website: "",
      status: "ACTIVE",
    };
    const incoming = {
      name: "Acme Renamed",
      industry: "Construction",
      website: "https://acme.example",
      status: "INACTIVE",
    };
    expect(mergeFillBlanks(existing, incoming)).toEqual({
      industry: "Construction",
      website: "https://acme.example",
    });
  });

  it("never writes blank incoming values, even over blank existing ones", () => {
    const existing = { phone: null, notes: null };
    const incoming = { phone: "", notes: null };
    expect(mergeFillBlanks(existing, incoming)).toEqual({});
  });

  it("never overwrites numbers or booleans (they are never blank)", () => {
    const existing = { sortOrder: 0, isPreferred: false };
    const incoming = { sortOrder: 5, isPreferred: true };
    expect(mergeFillBlanks(existing, incoming)).toEqual({});
  });

  it("fills empty arrays but not populated ones", () => {
    const existing = { specialties: [] as string[], tags: ["a"] };
    const incoming = { specialties: ["AWS"], tags: ["b"] };
    expect(mergeFillBlanks(existing, incoming)).toEqual({ specialties: ["AWS"] });
  });

  it("falls back to the full incoming payload when the existing record is missing", () => {
    const incoming = { name: "X", notes: null };
    expect(mergeFillBlanks(null, incoming)).toEqual(incoming);
  });
});

describe("buildResult", () => {
  it("derives every count from the rows, including warnings", () => {
    const rows: ImportRowResult[] = [
      { row: 1, status: "imported" },
      { row: 2, status: "imported", warnings: ["dropped FK"] },
      { row: 3, status: "updated", warnings: ["coerced enum", "dropped FK"] },
      { row: 4, status: "skipped", message: "already exists" },
      { row: 5, status: "failed", message: "boom" },
      // Warnings on non-written rows don't count toward the total.
      { row: 6, status: "failed", message: "boom", warnings: ["irrelevant"] },
    ];
    expect(buildResult(rows)).toEqual({
      imported: 2,
      updated: 1,
      skipped: 1,
      failed: 2,
      warnings: 2,
      rows,
    });
  });
});

describe("warnList / addWarning", () => {
  it("warnList returns undefined for empty lists", () => {
    expect(warnList([])).toBeUndefined();
    expect(warnList(["w"])).toEqual(["w"]);
  });

  it("addWarning appends to (or creates) the warnings array in place", () => {
    const row: ImportRowResult = { row: 1, status: "imported" };
    addWarning(row, "first");
    addWarning(row, "second");
    expect(row.warnings).toEqual(["first", "second"]);
    // Tolerates a missing target (e.g. out-of-range index).
    expect(() => addWarning(undefined, "x")).not.toThrow();
  });
});
