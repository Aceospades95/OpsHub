/**
 * LocalDriver — filesystem-backed storage for development and self-hosted
 * deployments. Stores files under a root directory (default `.storage/files/`)
 * using the caller-provided key as the relative path.
 *
 * Security notes:
 * - Keys are sanitized to prevent path traversal (no "../" segments)
 * - Files are served through /api/files/[id] which checks auth before
 *   streaming, so private files are not publicly accessible via direct URL
 * - The storage root should NOT be inside the Next.js public/ directory
 *
 * This driver is the default. For production S3/Drive, add a new driver
 * file and switch STORAGE_DRIVER in env.
 */

import { promises as fs } from "fs";
import path from "path";
import type { StorageDriver, StoragePutInput, StoragePutResult } from "./types";

/**
 * Resolve the storage root directory. Defaults to `.storage/files` at the
 * project root. Override with STORAGE_LOCAL_DIR env var.
 */
function getRoot(): string {
  const configured = process.env.STORAGE_LOCAL_DIR;
  if (configured && path.isAbsolute(configured)) return configured;
  return path.resolve(process.cwd(), configured || ".storage/files");
}

/**
 * Sanitize a caller-provided key. Collapses any path separators and strips
 * traversal segments so we can't accidentally write outside the root.
 */
function sanitizeKey(key: string): string {
  // Remove leading slashes and any .. segments
  const cleaned = key
    .replace(/^[/\\]+/, "")
    .split(/[/\\]/)
    .filter((seg) => seg && seg !== "..")
    .join("/");
  if (!cleaned) throw new Error("Storage key cannot be empty");
  return cleaned;
}

/**
 * Convert a sanitized key to an absolute filesystem path, verifying that
 * the result still lives inside the storage root (defense in depth).
 */
function keyToPath(key: string): string {
  const root = getRoot();
  const safe = sanitizeKey(key);
  const full = path.resolve(root, safe);
  if (!full.startsWith(root + path.sep) && full !== root) {
    throw new Error(`Resolved path escapes storage root: ${key}`);
  }
  return full;
}

export const localDriver: StorageDriver = {
  name: "local",

  async put({ key, content }: StoragePutInput): Promise<StoragePutResult> {
    const filePath = keyToPath(key);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, content);
    return { key: sanitizeKey(key), size: content.length };
  },

  async get(key: string): Promise<Buffer> {
    const filePath = keyToPath(key);
    return fs.readFile(filePath);
  },

  async delete(key: string): Promise<void> {
    const filePath = keyToPath(key);
    try {
      await fs.unlink(filePath);
    } catch (err) {
      // Swallow "not found" so delete is idempotent
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
  },

  async exists(key: string): Promise<boolean> {
    const filePath = keyToPath(key);
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  },
};
