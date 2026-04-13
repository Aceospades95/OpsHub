/**
 * URL helpers — small utilities used by notification emails and other
 * places that need an absolute URL for a relative app path (because
 * email clients can't follow `/projects/abc`).
 *
 * The base URL is read from NEXTAUTH_URL since that's the existing
 * convention for the auth callback. Override with NEXTAUTH_URL in env
 * for production deployments.
 */

/**
 * Build an absolute URL from a relative path. Trailing slashes on the
 * base are stripped, leading slashes on the path are normalized.
 *
 * Example:
 *   absoluteUrl("/projects/abc")
 *   // → "https://app.opshub.local/projects/abc"
 */
export function absoluteUrl(path: string): string {
  const base = (process.env.NEXTAUTH_URL || "http://localhost:3000").replace(/\/$/, "");
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${base}${normalizedPath}`;
}
