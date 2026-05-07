import { redirect } from "next/navigation";

/**
 * Legacy `/settings` URL — the actual hub lives at `/admin`. Sidebar
 * links go straight to `/admin`, but old bookmarks and external
 * docs still hit `/settings` and used to 404. Permanent redirect
 * preserves them.
 */
export default function SettingsRedirect(): never {
  redirect("/admin");
}
