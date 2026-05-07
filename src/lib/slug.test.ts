import { describe, it, expect } from "vitest";
import { slugify, ensureUniqueSlug } from "./slug";

describe("slugify", () => {
  it("lowercases and replaces whitespace with dashes", () => {
    expect(slugify("Acme Corp")).toBe("acme-corp");
  });

  it("collapses runs of non-alphanumeric into single dashes", () => {
    expect(slugify("Foo &  Bar — Baz!")).toBe("foo-bar-baz");
  });

  it("strips leading and trailing dashes", () => {
    expect(slugify("  --hello world--  ")).toBe("hello-world");
  });

  it("caps the result at 60 characters and re-trims dashes", () => {
    const long = "a".repeat(80);
    expect(slugify(long).length).toBeLessThanOrEqual(60);
  });

  it("falls back to a random token when input has no usable chars", () => {
    const a = slugify("🎉🎉🎉");
    const b = slugify("...");
    // Both should produce something non-empty and not just dashes.
    expect(a.length).toBeGreaterThan(0);
    expect(a).not.toMatch(/^-+$/);
    expect(b.length).toBeGreaterThan(0);
  });

  it("preserves digits", () => {
    expect(slugify("Q4 2026 Plan")).toBe("q4-2026-plan");
  });
});

describe("ensureUniqueSlug", () => {
  it("returns the base slug when it isn't taken", async () => {
    const result = await ensureUniqueSlug("acme-corp", async () => false);
    expect(result).toBe("acme-corp");
  });

  it("appends -2 when the base is taken", async () => {
    const taken = new Set(["acme-corp"]);
    const result = await ensureUniqueSlug("acme-corp", async (c) => taken.has(c));
    expect(result).toBe("acme-corp-2");
  });

  it("walks past sequential collisions", async () => {
    const taken = new Set(["acme-corp", "acme-corp-2", "acme-corp-3"]);
    const result = await ensureUniqueSlug("acme-corp", async (c) => taken.has(c));
    expect(result).toBe("acme-corp-4");
  });

  it("throws after 50 attempts to avoid infinite loops", async () => {
    await expect(
      ensureUniqueSlug("x", async () => true)
    ).rejects.toThrow(/gave up after 50 attempts/);
  });
});
