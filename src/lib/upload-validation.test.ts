import { describe, it, expect } from "vitest";
import { sniffUploadType } from "./upload-validation";

/**
 * R11-H: server-side magic-byte sniff. The browser's file.type is
 * client-controlled — a curl request can label its payload anything.
 * These tests pin down the four scenarios the spec calls out:
 *
 *   - declared+detected agree → ok
 *   - declared lies (renamed extension) → reject
 *   - public branding upload + SVG declared → reject (XSS)
 *   - unknown magic bytes → reject
 *
 * Plus the obvious legitimate passes for each format.
 */

const PDF = Buffer.concat([
  Buffer.from([0x25, 0x50, 0x44, 0x46]), // %PDF
  Buffer.from("-1.4\n%%body bytes here\n"),
]);
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from("rest of png"),
]);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.from("body")]);
const GIF = Buffer.from("GIF89a\x00\x00\x00\x00", "binary");
const WEBP = Buffer.concat([
  Buffer.from("RIFF"),
  Buffer.from([0x00, 0x00, 0x00, 0x00]), // size placeholder
  Buffer.from("WEBP"),
  Buffer.from("body"),
]);
const ZIP = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from("body")]);
const SVG = Buffer.from('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"></svg>');
const SVG_INLINE = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
const FAKE_PDF = Buffer.from("This is not a PDF file at all", "utf8");
// Looks like a Windows EXE — MZ header
const EXE = Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00]);

describe("sniffUploadType — happy path", () => {
  it.each([
    ["application/pdf", PDF],
    ["image/png", PNG],
    ["image/jpeg", JPEG],
    ["image/gif", GIF],
    ["image/webp", WEBP],
    ["image/svg+xml", SVG],
    ["image/svg+xml", SVG_INLINE],
  ])("matches declared %s with correct magic bytes", (declared, buf) => {
    const result = sniffUploadType(buf, declared);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.detectedType).toBe(declared);
  });

  it("accepts ZIP magic for an OOXML-declared upload (DOCX is ZIP-based)", () => {
    const result = sniffUploadType(
      ZIP,
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    );
    expect(result.ok).toBe(true);
  });

  it("ignores ;charset suffix in the declared MIME", () => {
    const result = sniffUploadType(PDF, "application/pdf;charset=binary");
    expect(result.ok).toBe(true);
  });
});

describe("sniffUploadType — reject paths", () => {
  it("rejects a renamed .exe declared as application/pdf", () => {
    const result = sniffUploadType(EXE, "application/pdf");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/Unrecognized/i);
  });

  it("rejects a fake PDF that has the right declared type but wrong bytes", () => {
    const result = sniffUploadType(FAKE_PDF, "application/pdf");
    expect(result.ok).toBe(false);
  });

  it("rejects a PNG byte stream declared as image/jpeg (mismatch)", () => {
    const result = sniffUploadType(PNG, "image/jpeg");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/MIME mismatch/i);
  });

  it("rejects SVG when blockSvg is true (branding / public uploads)", () => {
    const result = sniffUploadType(SVG, "image/svg+xml", { blockSvg: true });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/SVG/i);
  });

  it("allows SVG when blockSvg is false (default for private uploads)", () => {
    const result = sniffUploadType(SVG, "image/svg+xml", { blockSvg: false });
    expect(result.ok).toBe(true);
  });

  it("rejects an empty buffer", () => {
    const result = sniffUploadType(Buffer.alloc(0), "application/pdf");
    expect(result.ok).toBe(false);
  });
});
