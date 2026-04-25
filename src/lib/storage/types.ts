/**
 * Shared types for the file storage infrastructure.
 *
 * Same shape as the email layer: driver interface + driver registry +
 * public API. Each driver handles a different backend (local filesystem,
 * S3, Google Drive, etc.) but callers only ever interact with the
 * uploadFile/getFile/deleteFile functions in index.ts.
 */

/** A file being uploaded. Contents come as a Buffer so drivers don't care about streams. */
export interface StoragePutInput {
  /** Driver-generated or caller-provided key. Unique per driver. */
  key: string;
  /** File bytes */
  content: Buffer;
  /** MIME type for storage metadata and downstream serving */
  contentType: string;
}

/** Result of a put() operation. */
export interface StoragePutResult {
  /** Final storage key (drivers may rewrite it, e.g., to add a prefix) */
  key: string;
  /** Byte size of the stored content */
  size: number;
}

/** Parameters for generating a time-limited URL the browser can fetch directly. */
export interface SignedUrlOptions {
  /** TTL in seconds. Drivers may clamp to a sensible maximum. */
  expiresIn: number;
  /** MIME type the response should advertise. */
  contentType: string;
  /** Original filename for the Content-Disposition header. */
  filename: string;
  /** Whether the browser should render or download the response. */
  disposition: "inline" | "attachment";
}

/**
 * A storage driver is responsible for actually persisting bytes somewhere
 * and returning them on demand. Drivers should be stateless and thread-safe.
 *
 * Drivers do NOT know about permissions, auditing, or database records —
 * those live at the public API layer in index.ts.
 */
export interface StorageDriver {
  /** Unique name used in File.storageDriver */
  name: string;

  /** Store bytes under the given key. */
  put(input: StoragePutInput): Promise<StoragePutResult>;

  /** Read bytes back. Should throw if the key doesn't exist. */
  get(key: string): Promise<Buffer>;

  /** Delete the file. No-op if the key doesn't exist. */
  delete(key: string): Promise<void>;

  /**
   * Return true if a key exists. Used for sanity checks.
   * Most drivers implement this as a cheap head/stat call.
   */
  exists(key: string): Promise<boolean>;

  /**
   * Optional: return a time-limited URL that the browser can fetch directly,
   * bypassing the Next.js server. Drivers backed by object storage (S3, R2,
   * GCS) should implement this so file downloads don't proxy through the
   * application. Drivers without a public-fetchable backend (local
   * filesystem) should leave this undefined; the route handler will fall
   * back to streaming bytes through `get()`.
   */
  getSignedUrl?(key: string, options: SignedUrlOptions): Promise<string>;
}
