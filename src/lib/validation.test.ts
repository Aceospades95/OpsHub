import { describe, it, expect } from "vitest";
import { z } from "zod";
import { rejectHtmlChars, nameField, HTML_CHARS_MESSAGE } from "./validation";

describe("rejectHtmlChars", () => {
  it("accepts plain text and unicode", () => {
    expect(rejectHtmlChars("Acme Corp")).toBe(true);
    expect(rejectHtmlChars("Café")).toBe(true);
    expect(rejectHtmlChars("Renée O'Connor")).toBe(true);
    expect(rejectHtmlChars("Smith & Sons, LLC")).toBe(true);
    expect(rejectHtmlChars("🚀 Q1 Project — 2026")).toBe(true);
    expect(rejectHtmlChars("你好")).toBe(true);
  });

  it("rejects angle brackets (the QA <script> repro payload)", () => {
    expect(rejectHtmlChars("<script>alert(1)</script>")).toBe(false);
    expect(rejectHtmlChars("Project <name>")).toBe(false);
    expect(rejectHtmlChars(">starts with bracket")).toBe(false);
    expect(rejectHtmlChars("just <")).toBe(false);
    expect(rejectHtmlChars("just >")).toBe(false);
  });

  it("rejects the nul byte (Postgres choke)", () => {
    expect(rejectHtmlChars("hidden\x00null")).toBe(false);
  });
});

describe("nameField", () => {
  it("requires a non-empty trimmed value", () => {
    const schema = nameField({ label: "Name" });
    expect(schema.safeParse("").success).toBe(false);
    expect(schema.safeParse("   ").success).toBe(false);
    expect(schema.safeParse("Acme").success).toBe(true);
  });

  it("trims whitespace silently", () => {
    const schema = nameField({ label: "Name" });
    const result = schema.safeParse("  Acme Corp  ");
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toBe("Acme Corp");
  });

  it("rejects HTML payloads with the standard message", () => {
    const schema = nameField({ label: "Name" });
    const result = schema.safeParse("Acme <script>alert(1)</script>");
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toBe(HTML_CHARS_MESSAGE);
    }
  });

  it("respects a custom max length", () => {
    const schema = nameField({ label: "Name", max: 5 });
    expect(schema.safeParse("12345").success).toBe(true);
    expect(schema.safeParse("123456").success).toBe(false);
  });

  it("works inside a parent zod object", () => {
    const wrapped = z.object({ name: nameField({ label: "Name" }) });
    expect(wrapped.safeParse({ name: "ok" }).success).toBe(true);
    expect(wrapped.safeParse({ name: "<bad>" }).success).toBe(false);
  });
});
