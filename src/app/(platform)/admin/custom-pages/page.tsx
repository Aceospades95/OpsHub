import { redirect } from "next/navigation";

/**
 * Legacy `/admin/custom-pages` URL — the actual list lives at
 * `/sandbox`. The Settings hub tile already points at /sandbox,
 * but old bookmarks and external docs still hit /admin/custom-pages
 * and used to 404. Permanent redirect preserves them. Mirrors the
 * /settings → /admin redirect added in round 4.
 */
export default function CustomPagesRedirect(): never {
  redirect("/sandbox");
}
