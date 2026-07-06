/**
 * Upload size limits shared by server actions and their upload UIs.
 *
 * Keep these AT OR BELOW next.config.js `serverActions.bodySizeLimit`
 * (currently "10mb"): the transport rejects bigger multipart bodies with
 * a 413 before any action code runs, so a server-side check alone can
 * never produce a friendly error. Clients should pre-check `file.size`
 * against the limit and surface `describeMaxUpload()` on failure.
 */

export const MAX_RECEIPT_UPLOAD_BYTES = 10 * 1024 * 1024;

export function describeMaxUpload(bytes: number): string {
  return `${Math.floor(bytes / (1024 * 1024))}MB`;
}
