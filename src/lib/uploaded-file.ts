/**
 * Structural test for "this FormData entry is a file the browser uploaded".
 *
 * Node 20 exposes `globalThis.File` so `value instanceof File` would now
 * work too. We keep the duck-type check because it's strictly more
 * portable: it succeeds on any future test runner / edge runtime that
 * supplies a Blob-shaped object even if the prototype chain doesn't
 * line up. There's no functional gap between this and `instanceof File`
 * in either direction; the structural check is just defensively
 * forward-compatible.
 *
 * The other shape `formData.get(...)` can return is `string` (or `null`
 * when the key is missing), so eliminating those is enough.
 */

export interface UploadedFile {
  name: string;
  size: number;
  type: string;
  text(): Promise<string>;
  arrayBuffer(): Promise<ArrayBuffer>;
}

export function asUploadedFile(value: unknown): UploadedFile | null {
  if (!value || typeof value !== "object") return null;
  if (typeof value === "string") return null;
  const v = value as Record<string, unknown>;
  if (typeof v.name !== "string") return null;
  if (typeof v.size !== "number") return null;
  if (typeof v.text !== "function") return null;
  if (typeof v.arrayBuffer !== "function") return null;
  return value as unknown as UploadedFile;
}
