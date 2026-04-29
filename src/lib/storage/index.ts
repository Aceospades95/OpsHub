/**
 * File storage — public API.
 *
 * This is the single entry point other features should use when they need
 * to upload, fetch, or delete files. It handles:
 *   - Resolving the active driver from env config
 *   - Generating unique storage keys
 *   - Creating/updating File rows in the database
 *   - Returning a URL suitable for <img src> and download links
 *
 * Example usage:
 *
 *   import { uploadFile } from "@/lib/storage";
 *
 *   const file = await uploadFile({
 *     content: buffer,
 *     filename: "logo.png",
 *     contentType: "image/png",
 *     uploadedById: user.id,
 *     visibility: "public",
 *   });
 *
 *   // file.url is now "/api/files/{file.id}" — use it in <img src>.
 *
 * In development the default "local" driver writes to .storage/files/
 * which is gitignored. Set STORAGE_DRIVER=s3 (or another registered
 * driver) to route uploads to a real backend.
 */

import { randomUUID } from "crypto";
import { db } from "@/lib/db";
import { log } from "@/lib/log";
import { getActiveDriver, getDriverByName } from "./drivers";
import type { StorageDriver } from "./types";

// Re-export types so consumers can import everything from @/lib/storage
export type { StorageDriver, StoragePutInput, StoragePutResult } from "./types";

/**
 * Per-user soft cap on total stored bytes. Default 1 GiB; override
 * with USER_STORAGE_QUOTA_BYTES. The cap is informational at the API
 * level — the actual enforcement happens before the driver writes
 * bytes so an over-quota user doesn't run up storage cost on a
 * rejected upload.
 *
 * "system" uploadedById (used by the workflow portal for CUSTOM
 * subjects) bypasses the quota — the system isn't a user, and the
 * portal upload route already gates traffic with its own rate limit.
 */
const DEFAULT_USER_QUOTA_BYTES = 1024 * 1024 * 1024; // 1 GiB

function getUserQuotaBytes(): number {
  const raw = process.env.USER_STORAGE_QUOTA_BYTES;
  if (!raw) return DEFAULT_USER_QUOTA_BYTES;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_USER_QUOTA_BYTES;
}

export class StorageQuotaExceededError extends Error {
  readonly used: number;
  readonly quota: number;
  readonly attempted: number;
  constructor(used: number, quota: number, attempted: number) {
    super(
      `Storage quota exceeded: ${used} + ${attempted} > ${quota} bytes for this user`
    );
    this.name = "StorageQuotaExceededError";
    this.used = used;
    this.quota = quota;
    this.attempted = attempted;
  }
}

/**
 * Sum the bytes currently attributed to a user's uploads. Excludes
 * already-deleted (soft or hard) rows by definition since we delete
 * the File row on `deleteFile`.
 */
async function sumUserBytes(uploadedById: string): Promise<number> {
  const r = await db.file.aggregate({
    where: { uploadedById },
    _sum: { size: true },
  });
  return r._sum.size ?? 0;
}

/**
 * Upload a file and create the corresponding File row. Returns the full
 * File record with its serving URL populated.
 *
 * Throws `StorageQuotaExceededError` when the upload would put the
 * user over the configured per-user quota — caller should catch and
 * surface a friendly 413/quota-exceeded response.
 */
export async function uploadFile(params: {
  /** Raw file contents */
  content: Buffer;
  /** Original filename — used for the `name` column and the Content-Disposition header when downloaded */
  filename: string;
  /** MIME type */
  contentType: string;
  /** User performing the upload */
  uploadedById: string;
  /** Visibility: "public" means anyone with the URL can read, "private" requires auth */
  visibility?: "public" | "private";
  /**
   * Optional parent entity for legacy File model FKs. Supply one of these
   * so existing consumers (project detail, contract detail, etc.) can
   * find the file through their existing relations.
   */
  projectId?: string;
  contractId?: string;
  documentId?: string;
  supplierId?: string;
  intranetResourceId?: string;
  certificationId?: string;
  /** Target user id when attaching a file to an employee profile. */
  userId?: string;
  /** Freeform category tag, currently used by the employee files UI. */
  category?: string;
}) {
  const driver = getActiveDriver();

  // Per-user quota check. Skip for the "system" pseudo-user used by
  // the portal upload path (CUSTOM subject type) — the portal route
  // gates that traffic with its own per-token rate limit. Skip when
  // the env knob is set to 0 (disabled).
  const quota = getUserQuotaBytes();
  if (quota > 0 && params.uploadedById !== "system") {
    const used = await sumUserBytes(params.uploadedById);
    const attempted = params.content.byteLength;
    if (used + attempted > quota) {
      throw new StorageQuotaExceededError(used, quota, attempted);
    }
  }

  // Generate a unique storage key. Includes the driver name prefix so
  // mixed-driver deployments don't collide, plus a UUID for uniqueness,
  // plus the filename extension for at-a-glance debuggability.
  const ext = extractExtension(params.filename);
  const key = `${driver.name}/${randomUUID()}${ext}`;

  // Write to the backend first. If the driver fails, we don't create a
  // DB row pointing at missing bytes.
  const result = await driver.put({
    key,
    content: params.content,
    contentType: params.contentType,
  });

  // Create the File row. id is used in the public URL so consumers can
  // reference files without leaking the internal storage key.
  const file = await db.file.create({
    data: {
      name: params.filename,
      url: "", // filled in below now that we have the id
      size: result.size,
      mimeType: params.contentType,
      source: "upload",
      storageDriver: driver.name,
      storageKey: result.key,
      visibility: params.visibility || "private",
      uploadedById: params.uploadedById,
      projectId: params.projectId,
      contractId: params.contractId,
      documentId: params.documentId,
      supplierId: params.supplierId,
      intranetResourceId: params.intranetResourceId,
      certificationId: params.certificationId,
      userId: params.userId,
      category: params.category,
    },
  });

  // Patch the url now that we know the id. Not strictly required (the
  // route handler doesn't read file.url), but keeps the column meaningful
  // for legacy code that may read it directly.
  const url = `/api/files/${file.id}`;
  return db.file.update({
    where: { id: file.id },
    data: { url },
  });
}

/**
 * Metadata + driver lookup for serving a file, WITHOUT pulling bytes off
 * the backing store. The route handler should call this first so it can
 * run the auth gate before paying for an S3 GET (or a disk read), and
 * decide whether to redirect to a signed URL or stream bytes locally.
 *
 * Returns null if the file doesn't exist or its driver is unknown.
 */
export async function getFileForServing(fileId: string): Promise<{
  driver: StorageDriver;
  storageKey: string;
  contentType: string;
  filename: string;
  visibility: "public" | "private";
} | null> {
  const file = await db.file.findUnique({ where: { id: fileId } });
  if (!file) return null;
  if (!file.storageDriver || !file.storageKey) return null;

  const driver = getDriverByName(file.storageDriver);
  if (!driver) {
    log.error("storage.read", "File stored with unregistered driver", {
      fileId,
      storageDriver: file.storageDriver,
    });
    return null;
  }

  return {
    driver,
    storageKey: file.storageKey,
    contentType: file.mimeType || "application/octet-stream",
    filename: file.name,
    visibility: (file.visibility as "public" | "private") || "private",
  };
}

/**
 * Read file bytes. Used by the route handler when the active driver does
 * not support presigned URLs (e.g. local filesystem) and we need to stream
 * bytes through the Next.js server.
 *
 * Returns null if the file doesn't exist in the database or its bytes
 * can't be found on the backing store.
 */
export async function readFile(fileId: string): Promise<{
  buffer: Buffer;
  contentType: string;
  filename: string;
  visibility: "public" | "private";
} | null> {
  const meta = await getFileForServing(fileId);
  if (!meta) return null;
  try {
    const buffer = await meta.driver.get(meta.storageKey);
    return {
      buffer,
      contentType: meta.contentType,
      filename: meta.filename,
      visibility: meta.visibility,
    };
  } catch (err) {
    log.error("storage.read", "Failed to read file", err, { fileId });
    return null;
  }
}

/**
 * Delete a file from both the backing store and the database. Idempotent —
 * safe to call even if the file has already been removed.
 */
export async function deleteFile(fileId: string): Promise<void> {
  const file = await db.file.findUnique({ where: { id: fileId } });
  if (!file) return;

  // Remove backing bytes first (best effort — some drivers may already
  // have lost them). We still delete the DB row afterwards so orphan
  // metadata doesn't linger.
  if (file.storageDriver && file.storageKey) {
    const driver = getDriverByName(file.storageDriver);
    if (driver) {
      try {
        await driver.delete(file.storageKey);
      } catch (err) {
        log.error("storage.delete", "Failed to delete bytes", err, { fileId });
      }
    }
  }

  await db.file.delete({ where: { id: fileId } });
}

/** Build the serving URL for a file id. */
export function getFileUrl(fileId: string): string {
  return `/api/files/${fileId}`;
}

// ─── Helpers ───────────────────────────────────────────

function extractExtension(filename: string): string {
  const dot = filename.lastIndexOf(".");
  if (dot < 0) return "";
  const ext = filename.slice(dot).toLowerCase();
  // Only allow simple extensions to avoid weird suffixes in storage keys
  return /^\.[a-z0-9]{1,10}$/.test(ext) ? ext : "";
}

/**
 * Create a Buffer from a standard File or Blob (e.g., from a FormData upload).
 * Keeps callers from having to import Node's Buffer API directly.
 */
export async function blobToBuffer(blob: Blob): Promise<Buffer> {
  const arrayBuffer = await blob.arrayBuffer();
  return Buffer.from(arrayBuffer);
}
