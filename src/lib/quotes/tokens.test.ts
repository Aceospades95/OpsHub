import { describe, it, expect } from "vitest";
import { generateQuoteToken, hashToken } from "./tokens";

describe("generateQuoteToken", () => {
  it("returns a base64url-safe string", () => {
    const t = generateQuoteToken();
    // base64url uses A-Z, a-z, 0-9, '-', '_' and never includes '+', '/', '='
    expect(t).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(t).not.toContain("+");
    expect(t).not.toContain("/");
    expect(t).not.toContain("=");
  });

  it("produces unique tokens across many invocations", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      seen.add(generateQuoteToken());
    }
    expect(seen.size).toBe(200);
  });

  it("encodes 32 bytes (43 base64url characters, no padding)", () => {
    const t = generateQuoteToken();
    expect(t.length).toBe(43);
  });
});

describe("hashToken", () => {
  it("is deterministic for the same input", () => {
    const t = "abc123";
    expect(hashToken(t)).toBe(hashToken(t));
  });

  it("produces different hashes for different inputs", () => {
    expect(hashToken("a")).not.toBe(hashToken("b"));
  });

  it("returns a 64-character hex string (SHA-256)", () => {
    expect(hashToken("anything")).toMatch(/^[0-9a-f]{64}$/);
  });
});
