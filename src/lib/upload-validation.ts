/**
 * Server-side MIME validation via magic-byte sniffing.
 *
 * Pre-R11, every upload route trusted the browser's `file.type` header.
 * That string is whatever the client says it is — a curl invocation can
 * upload an .exe and label it `application/pdf`, and our route would
 * happily store it. This module sniffs the first few bytes of the
 * buffer and asserts they match the declared content-type.
 *
 * Coverage is intentionally narrow — we cover the formats actually
 * uploaded across the app (PDF, PNG, JPEG, GIF, WebP, SVG, common
 * Office formats) and reject everything else. A more permissive
 * "trust but verify" sniff is one CVE away from biting us.
 *
 * For branding / public uploads, callers should pass `blockSvg: true`
 * to reject SVG entirely — SVG can carry inline `<script>` and is a
 * known XSS vector when served back as a public asset.
 */

export type SniffResult =
  | { ok: true; detectedType: string }
  | { ok: false; reason: string };

/**
 * Sniff `buffer` and confirm it matches one of the declared MIME types.
 *
 * Behaviour:
 *  - If we recognize the magic bytes AND it matches `declaredContentType`
 *    (case-insensitive prefix match: "image/png" matches "image/png"),
 *    return ok.
 *  - If we recognize the magic bytes but they don't match the declared
 *    type, return { ok: false } — this catches the "rename .exe → .pdf"
 *    attack.
 *  - If we do NOT recognize the magic bytes, return { ok: false } so
 *    unknown formats (executables, archives, etc.) are rejected by
 *    default. Callers that need to allow arbitrary types should not
 *    use this helper.
 *  - If `blockSvg` is true, SVG is rejected even if declared. Used by
 *    branding / public-facing uploads where a stored XML body could
 *    be served back to the browser and execute inline script.
 */
export function sniffUploadType(
  buffer: Buffer,
  declaredContentType: string,
  opts: { blockSvg?: boolean } = {}
): SniffResult {
  const detected = detectMagic(buffer);
  if (!detected) {
    return {
      ok: false,
      reason: `Unrecognized file format (declared: ${declaredContentType || "unknown"})`,
    };
  }

  if (detected === "image/svg+xml" && opts.blockSvg) {
    return {
      ok: false,
      reason: "SVG uploads are blocked for this target (XSS risk)",
    };
  }

  const declared = (declaredContentType || "").toLowerCase().trim();
  // Some browsers send "application/pdf;charset=binary" or similar —
  // match on the prefix before the semicolon.
  const declaredBase = declared.split(";")[0].trim();

  if (!declaredBase) {
    return { ok: true, detectedType: detected };
  }

  // For Office formats, both "application/zip" and the specific OOXML
  // mime are acceptable, since the magic bytes are the ZIP container.
  if (detected === "application/zip" && OFFICE_MIME_TYPES.has(declaredBase)) {
    return { ok: true, detectedType: detected };
  }

  if (detected !== declaredBase) {
    return {
      ok: false,
      reason: `MIME mismatch: declared ${declaredBase}, detected ${detected}`,
    };
  }

  return { ok: true, detectedType: detected };
}

const OFFICE_MIME_TYPES = new Set([
  "application/zip",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
]);

/**
 * Inspect the first few bytes of a buffer and return a canonical MIME
 * if the magic bytes match a known format, or null otherwise.
 *
 * Order matters — formats whose magic bytes are a prefix of another
 * format's must be checked first.
 */
function detectMagic(buf: Buffer): string | null {
  if (buf.length < 4) return null;

  // PDF — "%PDF"
  if (buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46) {
    return "application/pdf";
  }

  // PNG — 0x89 P N G \r \n 0x1a \n
  if (
    buf.length >= 8 &&
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47 &&
    buf[4] === 0x0d &&
    buf[5] === 0x0a &&
    buf[6] === 0x1a &&
    buf[7] === 0x0a
  ) {
    return "image/png";
  }

  // JPEG — 0xff 0xd8 0xff
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return "image/jpeg";
  }

  // GIF — "GIF87a" or "GIF89a"
  if (
    buf.length >= 6 &&
    buf[0] === 0x47 &&
    buf[1] === 0x49 &&
    buf[2] === 0x46 &&
    buf[3] === 0x38 &&
    (buf[4] === 0x37 || buf[4] === 0x39) &&
    buf[5] === 0x61
  ) {
    return "image/gif";
  }

  // WebP — "RIFF" + 4 bytes + "WEBP"
  if (
    buf.length >= 12 &&
    buf[0] === 0x52 &&
    buf[1] === 0x49 &&
    buf[2] === 0x46 &&
    buf[3] === 0x46 &&
    buf[8] === 0x57 &&
    buf[9] === 0x45 &&
    buf[10] === 0x42 &&
    buf[11] === 0x50
  ) {
    return "image/webp";
  }

  // ZIP-container (covers DOCX / XLSX / PPTX in addition to plain .zip)
  // 0x50 0x4b 0x03 0x04
  if (buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04) {
    return "application/zip";
  }

  // SVG — opens with `<?xml` or `<svg`, possibly with a UTF-8 BOM
  // (0xef 0xbb 0xbf) or whitespace. Sniff the first ~512 bytes as
  // text and look for an <svg open tag.
  const head = buf.slice(0, Math.min(buf.length, 512)).toString("utf8");
  const trimmed = head.replace(/^﻿/, "").trimStart();
  if (trimmed.startsWith("<?xml") || trimmed.startsWith("<svg")) {
    // If it's <?xml, look ahead for <svg before declaring image/svg+xml.
    if (trimmed.startsWith("<svg") || /<svg[\s>]/.test(trimmed)) {
      return "image/svg+xml";
    }
  }

  return null;
}
