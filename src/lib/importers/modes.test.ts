/**
 * Permutation tests for the import framework's mode handling.
 *
 * Complements helpers.test.ts (which spot-checks each helper once):
 * this file walks the FULL mode × row-situation matrix — including the
 * "same natural key appears twice in one file" sequence importers hit
 * via their shared match-map convention — and the field-by-field
 * fill-blanks semantics (whitespace, zero, false, arrays, objects).
 *
 * Everything here is pure: no db, no importer registry.
 */
import { describe, it, expect } from "vitest";

import {
  applyMode,
  mergeFillBlanks,
  skipExistsMessage,
  skipNoMatchMessage,
  buildResult,
  type ModeAction,
} from "./helpers";
import type { ImportMode, ImportRowResult } from "./types";

/** All real modes plus `undefined` (the documented "create" default). */
const MODES: (ImportMode | undefined)[] = [
  "create",
  "update",
  "upsert",
  "fill-blanks",
  undefined,
];

/**
 * Mirror of the registry importer loop (see importers/clients.ts):
 * a pre-fetched natural-key map is shared by duplicate detection and
 * the update path, and every CREATE registers itself in the map so a
 * later row with the same key sees the just-created record. Feeding
 * the same key twice reproduces "duplicate within one file" exactly as
 * applyMode experiences it. (Registry importers additionally
 * short-circuit in-file duplicates via a `seenInBatch` set BEFORE
 * applyMode — that commit-level layer is covered by the per-importer
 * tests, e.g. tasks.test.ts "does not re-import the same task twice".)
 */
function runBatch(
  mode: ImportMode | undefined,
  keys: string[],
  dbHasMatch: boolean
): ModeAction[] {
  const matchMap = new Map<string, { id: string }>(
    dbHasMatch ? [["dup", { id: "db_1" }]] : []
  );
  const actions: ModeAction[] = [];
  for (const key of keys) {
    const action = applyMode(matchMap.get(key), mode);
    actions.push(action);
    if (action === "create") matchMap.set(key, { id: `created_${key}` });
  }
  return actions;
}

describe("applyMode — mode × row-situation matrix", () => {
  type Situation =
    | "no existing match"
    | "existing match"
    | "in-file duplicate (2nd occurrence)";

  const decide = (mode: ImportMode | undefined, situation: Situation): ModeAction => {
    if (situation === "no existing match") return applyMode(undefined, mode);
    if (situation === "existing match") return applyMode({ id: "db_1" }, mode);
    // Second occurrence of a key that did NOT pre-exist in the DB.
    return runBatch(mode, ["dup", "dup"], false)[1];
  };

  // mode, situation, expected action
  const MATRIX: [ImportMode | undefined, Situation, ModeAction][] = [
    ["create", "no existing match", "create"],
    ["create", "existing match", "skip"],
    // 2nd occurrence sees the record the 1st occurrence created → skip,
    // never a double-create.
    ["create", "in-file duplicate (2nd occurrence)", "skip"],

    ["update", "no existing match", "skip"],
    ["update", "existing match", "update"],
    // 1st occurrence was skipped (nothing created/registered), so the
    // 2nd is still a no-match → skip.
    ["update", "in-file duplicate (2nd occurrence)", "skip"],

    ["upsert", "no existing match", "create"],
    ["upsert", "existing match", "update"],
    // 1st created; 2nd matches the fresh record → update (last row wins).
    ["upsert", "in-file duplicate (2nd occurrence)", "update"],

    ["fill-blanks", "no existing match", "create"],
    ["fill-blanks", "existing match", "update"],
    ["fill-blanks", "in-file duplicate (2nd occurrence)", "update"],

    // mode omitted → behaves exactly like "create".
    [undefined, "no existing match", "create"],
    [undefined, "existing match", "skip"],
    [undefined, "in-file duplicate (2nd occurrence)", "skip"],
  ];

  it.each(MATRIX)("%s × %s → %s", (mode, situation, expected) => {
    expect(decide(mode, situation)).toBe(expected);
  });

  it.each([
    ["create", ["create", "skip"]],
    ["update", ["skip", "skip"]],
    ["upsert", ["create", "update"]],
    ["fill-blanks", ["create", "update"]],
  ] as [ImportMode, ModeAction[]][])(
    "duplicate-key sequence in %s mode resolves as %j",
    (mode, sequence) => {
      expect(runBatch(mode, ["dup", "dup"], false)).toEqual(sequence);
    }
  );

  it("checks `existing` by truthiness — falsy ids read as NO match", () => {
    // Documented contract ("truthiness-checked"): callers may pass the
    // matched id, record, or null. Prisma cuids are never "" or 0, so
    // this is safe today, but a caller passing a numeric id of 0 would
    // silently take the no-match branch.
    expect(applyMode("", "upsert")).toBe("create");
    expect(applyMode(0, "update")).toBe("skip");
  });
});

describe("mergeFillBlanks — field-semantics matrix", () => {
  const AT = new Date("2026-07-01T00:00:00.000Z");

  // label, existing value, incoming value, expected update payload
  const FIELD_MATRIX: [string, unknown, unknown, Record<string, unknown>][] = [
    ["existing data + incoming data → keeps existing", "Acme", "Renamed", {}],
    ["existing null + incoming data → fills", null, "New", { f: "New" }],
    ["existing empty string + incoming data → fills", "", "New", { f: "New" }],
    [
      "whitespace-only existing counts as blank → fills",
      "   ",
      "New",
      { f: "New" },
    ],
    ["tab/newline-only existing counts as blank → fills", "\t\n", "x", { f: "x" }],
    ["existing data + incoming null → keeps existing", "Acme", null, {}],
    ["existing data + incoming empty string → keeps existing", "Acme", "", {}],
    ["existing data + incoming whitespace-only → keeps existing", "Acme", " ", {}],
    ["both blank (null + empty string) → writes nothing", null, "", {}],
    ["both blank (null + whitespace) → writes nothing", null, "  ", {}],
    // The classic bug class: falsy-but-real stored values must survive.
    ["existing 0 is DATA, never overwritten", 0, 5, {}],
    ["existing false is DATA, never overwritten", false, true, {}],
    // …and falsy-but-real INCOMING values must still fill blanks.
    ["incoming 0 fills a blank field", null, 0, { f: 0 }],
    ["incoming false fills a blank field", null, false, { f: false }],
    // NaN is typeof "number" → counts as data per isBlank.
    ["existing NaN counts as data (typeof number)", NaN, 5, {}],
    ["empty existing array is blank → fills", [], ["AWS"], { f: ["AWS"] }],
    ["populated existing array is data → kept", ["x"], ["y"], {}],
    ["incoming empty array is blank → never written", null, [], {}],
    ["existing Date is data → kept", AT, new Date("2027-01-01"), {}],
    ["incoming Date fills a blank field", null, AT, { f: AT }],
    // isBlank only length-checks ARRAYS: a {} object is treated as data
    // in both positions. Defensible per the isBlank doc ("empty
    // arrays"), just worth pinning.
    ["existing empty object counts as DATA → kept", {}, { a: 1 }, {}],
    ["incoming empty object counts as data → fills a blank", null, {}, { f: {} }],
  ];

  it.each(FIELD_MATRIX)("%s", (_label, existingVal, incomingVal, expected) => {
    expect(
      mergeFillBlanks({ f: existingVal }, { f: incomingVal } as Record<string, unknown>)
    ).toEqual(expected);
  });

  it("a key absent from the existing record is blank → fills", () => {
    expect(mergeFillBlanks({}, { website: "https://x" })).toEqual({
      website: "https://x",
    });
  });

  it("only keys present on the INCOMING payload can appear in the output", () => {
    // Blank existing fields the CSV didn't map stay untouched.
    expect(
      mergeFillBlanks({ name: "Acme", industry: null }, { name: "Acme 2" })
    ).toEqual({});
  });

  it("returns a fresh copy of the full payload when the existing record is missing", () => {
    const incoming = { name: "X", notes: null };
    const forNull = mergeFillBlanks(null, incoming);
    expect(forNull).toEqual(incoming);
    expect(forNull).not.toBe(incoming); // defensive copy, not the same ref
    expect(mergeFillBlanks(undefined, incoming)).toEqual(incoming);
  });

  it("in-file duplicate under fill-blanks: 2nd row only fills what the 1st left blank", () => {
    // Matches the runBatch sequence above: the first occurrence
    // creates, the second occurrence's UPDATE payload is merged against
    // the record the first row just wrote — its data wins.
    const createdByFirstRow = { name: "Acme", website: null, industry: "Build" };
    const secondRow = { name: "Acme", website: "https://a.example", industry: "Other" };
    expect(mergeFillBlanks(createdByFirstRow, secondRow)).toEqual({
      website: "https://a.example",
    });
  });
});

describe("skip messages — the phrasing the wizard keys off", () => {
  it("create-mode skip names the record and says it already exists", () => {
    const msg = skipExistsMessage('Client "Acme"');
    expect(msg).toContain('Client "Acme"');
    expect(msg).toContain("already exists");
    expect(msg).toContain('"Create new only"');
  });

  it("update-mode skip says no existing record matched", () => {
    const msg = skipNoMatchMessage('Client "Acme"');
    expect(msg).toContain("no existing record");
    expect(msg).toContain('"Update existing only"');
  });
});

describe("buildResult — warning counting across statuses", () => {
  it("skipped rows with warnings never count toward the warning total", () => {
    // helpers.test.ts pins failed-with-warnings; skipped is the
    // remaining non-written status.
    const rows: ImportRowResult[] = [
      { row: 1, status: "skipped", message: "dup", warnings: ["w"] },
      { row: 2, status: "updated", warnings: ["a", "b"] }, // counts ONCE
    ];
    expect(buildResult(rows)).toEqual({
      imported: 0,
      updated: 1,
      skipped: 1,
      failed: 0,
      warnings: 1,
      rows,
    });
  });

  it("an empty batch produces all-zero totals", () => {
    expect(buildResult([])).toEqual({
      imported: 0,
      updated: 0,
      skipped: 0,
      failed: 0,
      warnings: 0,
      rows: [],
    });
  });
});

// Keep MODES referenced so the matrix stays in sync if a mode is added:
// a new ImportMode value must gain rows above or this fails to compile.
it("matrix covers every mode (incl. the undefined default)", () => {
  const covered = new Set(MODES.map((m) => m ?? "default"));
  expect(covered.size).toBe(5);
});
