import { describe, it, expect } from "vitest";

// The where/orderBy builders are pure functions of (config, EntityDef).
// We import the test-only re-exports so we can drive them directly
// without spinning up Prisma.
import {
  _testBuildWhere as buildWhere,
  _testBuildOrderBy as buildOrderBy,
  _testCoerceFilterValue as coerce,
} from "./runtime";
import type { EntityDef, FilterDef } from "./entities";

// ─── Fixture entity ─────────────────────────────────────────────────────
//
// A minimal in-memory EntityDef that exercises every branch we care
// about: a string field, a number field, a date field, a boolean field,
// an enum field, and a relation-scoped string field.

const filters: FilterDef[] = [
  { key: "name", label: "Name", type: "string", operators: ["equals", "contains"] },
  { key: "value", label: "Value", type: "number", operators: ["gt", "gte", "lt", "lte", "equals"] },
  { key: "createdAt", label: "Created", type: "date", operators: ["gte", "lte"] },
  { key: "isActive", label: "Active", type: "boolean", operators: ["equals"] },
  {
    key: "status",
    label: "Status",
    type: "enum",
    operators: ["equals", "in"],
    enumValues: ["DRAFT", "ACTIVE", "ARCHIVED"],
  },
  {
    key: "client.name",
    label: "Client name",
    type: "string",
    operators: ["equals", "contains"],
    relation: "client",
  },
];

const FIXTURE: EntityDef = {
  label: "Fixture",
  description: "test entity",
  defaultColumns: ["name"],
  defaultSort: "name",
  defaultLimit: 100,
  columns: [
    { key: "name", label: "Name", type: "string" },
    { key: "value", label: "Value", type: "number" },
    { key: "createdAt", label: "Created", type: "date" },
    { key: "isActive", label: "Active", type: "boolean" },
    { key: "status", label: "Status", type: "enum" },
    { key: "client.name", label: "Client", type: "string", requiresRelation: "client" },
  ],
  filters,
  fetch: async () => [],
};

const filterByKey = new Map(filters.map((f) => [f.key, f]));
const numberDef = filterByKey.get("value")!;
const dateDef = filterByKey.get("createdAt")!;
const boolDef = filterByKey.get("isActive")!;
const enumDef = filterByKey.get("status")!;
const stringDef = filterByKey.get("name")!;

// ─── coerce ─────────────────────────────────────────────────────────────

describe("coerce", () => {
  it("returns null for null/undefined regardless of type", () => {
    expect(coerce(null, stringDef)).toBeNull();
    expect(coerce(undefined, numberDef)).toBeNull();
  });

  it("parses numeric strings on number fields", () => {
    expect(coerce("42", numberDef)).toBe(42);
    expect(coerce("1.5", numberDef)).toBe(1.5);
  });

  it("returns null on non-numeric strings for number fields", () => {
    expect(coerce("abc", numberDef)).toBeNull();
  });

  it("parses ISO date strings on date fields", () => {
    const r = coerce("2024-06-15", dateDef);
    expect(r).toBeInstanceOf(Date);
    expect((r as Date).getUTCFullYear()).toBe(2024);
  });

  it("returns null on unparseable date strings", () => {
    expect(coerce("not-a-date", dateDef)).toBeNull();
  });

  it("normalizes booleans (true/1/yes)", () => {
    expect(coerce(true, boolDef)).toBe(true);
    expect(coerce("true", boolDef)).toBe(true);
    expect(coerce("TRUE", boolDef)).toBe(true);
    expect(coerce("1", boolDef)).toBe(true);
    expect(coerce("yes", boolDef)).toBe(true);
  });

  it("normalizes booleans (false/0/no/empty)", () => {
    expect(coerce(false, boolDef)).toBe(false);
    expect(coerce("false", boolDef)).toBe(false);
    expect(coerce("0", boolDef)).toBe(false);
    expect(coerce("no", boolDef)).toBe(false);
    expect(coerce("", boolDef)).toBe(false);
  });

  it("returns null for ambiguous boolean inputs", () => {
    expect(coerce("maybe", boolDef)).toBeNull();
  });

  it("validates enum values against the allowlist", () => {
    expect(coerce("ACTIVE", enumDef)).toBe("ACTIVE");
    expect(coerce("BOGUS", enumDef)).toBeNull();
  });

  it("passes string fields through after String()", () => {
    expect(coerce(42, stringDef)).toBe("42");
    expect(coerce("hello", stringDef)).toBe("hello");
  });
});

// ─── buildWhere ─────────────────────────────────────────────────────────

describe("buildWhere", () => {
  it("drops filters whose field isn't in the registry", () => {
    const includes = new Set<string>();
    const w = buildWhere(
      {
        columns: [],
        filters: [{ field: "hashedPassword", op: "equals", value: "x" }],
      },
      FIXTURE,
      includes
    );
    expect(w).toEqual({});
  });

  it("drops filters using an operator the field doesn't expose", () => {
    const includes = new Set<string>();
    // `name` (string) doesn't expose `gt` — even though it's a real op
    // it's not in the field's `operators` list.
    const w = buildWhere(
      {
        columns: [],
        filters: [{ field: "name", op: "gt", value: "abc" }],
      },
      FIXTURE,
      includes
    );
    expect(w).toEqual({});
  });

  it("coerces numeric strings on number fields with gte", () => {
    const includes = new Set<string>();
    const w = buildWhere(
      {
        columns: [],
        filters: [{ field: "value", op: "gte", value: "100" }],
      },
      FIXTURE,
      includes
    );
    expect(w).toEqual({ value: { gte: 100 } });
  });

  it("drops gte filters with unparseable numeric values", () => {
    const includes = new Set<string>();
    const w = buildWhere(
      {
        columns: [],
        filters: [{ field: "value", op: "gte", value: "lots" }],
      },
      FIXTURE,
      includes
    );
    expect(w).toEqual({});
  });

  it("coerces ISO strings on date filters", () => {
    const includes = new Set<string>();
    const w = buildWhere(
      {
        columns: [],
        filters: [{ field: "createdAt", op: "gte", value: "2024-01-01" }],
      },
      FIXTURE,
      includes
    );
    const v = (w.createdAt as { gte: Date }).gte;
    expect(v).toBeInstanceOf(Date);
    expect(v.getUTCFullYear()).toBe(2024);
  });

  it("coerces 'true'/'false' string filters on boolean fields", () => {
    const includes = new Set<string>();
    const w = buildWhere(
      {
        columns: [],
        filters: [{ field: "isActive", op: "equals", value: "true" }],
      },
      FIXTURE,
      includes
    );
    expect(w).toEqual({ isActive: true });
  });

  it("coerces 'in' lists per element and drops invalid enum members", () => {
    const includes = new Set<string>();
    const w = buildWhere(
      {
        columns: [],
        filters: [
          { field: "status", op: "in", value: "DRAFT,BOGUS,ACTIVE" },
        ],
      },
      FIXTURE,
      includes
    );
    expect(w).toEqual({ status: { in: ["DRAFT", "ACTIVE"] } });
  });

  it("returns case-insensitive contains for string fields", () => {
    const includes = new Set<string>();
    const w = buildWhere(
      {
        columns: [],
        filters: [{ field: "name", op: "contains", value: "  Acme  " }],
      },
      FIXTURE,
      includes
    );
    expect(w).toEqual({ name: { contains: "Acme", mode: "insensitive" } });
  });

  it("nests relation filters under the relation key and tracks the include", () => {
    const includes = new Set<string>();
    const w = buildWhere(
      {
        columns: [],
        filters: [{ field: "client.name", op: "contains", value: "globex" }],
      },
      FIXTURE,
      includes
    );
    expect(w).toEqual({
      client: { name: { contains: "globex", mode: "insensitive" } },
    });
    expect(includes.has("client")).toBe(true);
  });

  it("drops empty equals filters (UI uses empty value to mean 'no filter')", () => {
    const includes = new Set<string>();
    const w = buildWhere(
      {
        columns: [],
        filters: [{ field: "name", op: "equals", value: "" }],
      },
      FIXTURE,
      includes
    );
    expect(w).toEqual({});
  });

  it("turns isNull / isNotNull into the right Prisma shapes", () => {
    const includes = new Set<string>();
    const localFilters: FilterDef[] = [
      ...filters,
      { key: "deletedAt", label: "Deleted", type: "date", operators: ["isNull", "isNotNull"] },
    ];
    const def: EntityDef = {
      ...FIXTURE,
      filters: localFilters,
      columns: [...FIXTURE.columns, { key: "deletedAt", label: "Deleted", type: "date" }],
    };
    const w = buildWhere(
      {
        columns: [],
        filters: [
          { field: "deletedAt", op: "isNull" },
          { field: "name", op: "isNotNull" as never },
        ],
      },
      def,
      includes
    );
    // Only the registered op survives — `name` doesn't expose isNotNull
    // in the fixture so it gets dropped.
    expect(w).toEqual({ deletedAt: { equals: null } });
  });
});

// ─── buildOrderBy ───────────────────────────────────────────────────────

describe("buildOrderBy", () => {
  it("uses the saved sortBy when it points at a registered column", () => {
    const includes = new Set<string>();
    const r = buildOrderBy(
      { columns: [], filters: [], sortBy: "value" },
      FIXTURE,
      includes
    );
    expect(r).toEqual({ value: "asc" });
  });

  it("respects the leading '-' for descending", () => {
    const includes = new Set<string>();
    const r = buildOrderBy(
      { columns: [], filters: [], sortBy: "-createdAt" },
      FIXTURE,
      includes
    );
    expect(r).toEqual({ createdAt: "desc" });
  });

  it("falls back to defaultSort when sortBy points at an unknown column", () => {
    const includes = new Set<string>();
    // hashedPassword isn't in FIXTURE.columns; we should fall back to
    // the entity's defaultSort instead of letting Prisma sort by it.
    const r = buildOrderBy(
      { columns: [], filters: [], sortBy: "hashedPassword" },
      FIXTURE,
      includes
    );
    expect(r).toEqual({ name: "asc" });
  });

  it("returns undefined when neither sortBy nor defaultSort is valid", () => {
    const includes = new Set<string>();
    const def: EntityDef = { ...FIXTURE, defaultSort: undefined };
    const r = buildOrderBy(
      { columns: [], filters: [], sortBy: "bogus" },
      def,
      includes
    );
    expect(r).toBeUndefined();
  });

  it("builds the nested Prisma form for relation.field sorts and adds the include", () => {
    const includes = new Set<string>();
    const r = buildOrderBy(
      { columns: [], filters: [], sortBy: "-client.name" },
      FIXTURE,
      includes
    );
    // The flat `{ client: "desc" }` form is INVALID for to-one
    // relations in Prisma — it must nest to the sub-field.
    expect(r).toEqual({ client: { name: "desc" } });
    expect(includes.has("client")).toBe(true);
  });
});
