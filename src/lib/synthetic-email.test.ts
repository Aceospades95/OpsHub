import { describe, it, expect } from "vitest";
import { isSyntheticEmail } from "./synthetic-email";

describe("isSyntheticEmail", () => {
  it("matches the timestamped placeholder pattern produced by createUser", () => {
    expect(isSyntheticEmail("nologin-1775667974875@internal.local")).toBe(true);
  });

  it("matches case-insensitively", () => {
    expect(isSyntheticEmail("NoLogin-123@INTERNAL.LOCAL")).toBe(true);
  });

  it("rejects regular addresses", () => {
    expect(isSyntheticEmail("alice@example.com")).toBe(false);
    expect(isSyntheticEmail("alex.admin@example.com")).toBe(false);
  });

  it("rejects look-alikes that aren't the actual placeholder shape", () => {
    expect(isSyntheticEmail("nologin@internal.local")).toBe(false);
    expect(isSyntheticEmail("nologin-@internal.local")).toBe(false);
    expect(isSyntheticEmail("nologin-123@example.com")).toBe(false);
    expect(isSyntheticEmail("admin-nologin-123@internal.local")).toBe(false);
  });

  it("returns false for null / undefined / empty", () => {
    expect(isSyntheticEmail(null)).toBe(false);
    expect(isSyntheticEmail(undefined)).toBe(false);
    expect(isSyntheticEmail("")).toBe(false);
    expect(isSyntheticEmail("   ")).toBe(false);
  });
});
