/**
 * Structural test for "this FormData entry is a file the browser uploaded".
 *
 * We do NOT use `instanceof File` because `File` isn't a global in Node
 * 18 (it's on `node:buffer` from 18.13 but not exposed on globalThis),
 * and the production Dockerfile pins `node:18-slim`. `instanceof File`
 * therefore throws a `ReferenceError` before any of our error handling
 * runs. Structural duck-typing covers Node 18 and Node 20+ identically.
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
