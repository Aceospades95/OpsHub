import Link from "next/link";
import { auth } from "@/lib/auth";
import { PlatformShell } from "@/components/layout/platform-shell";

/**
 * Global 404 boundary. Round-9 QA flagged that hitting an unknown
 * route (e.g. typo'd /admin/email) rendered the bare Next.js 404
 * — black page, no theme, no nav, no link home.
 *
 * Two-mode rendering:
 *   - Signed in: wrap the standard "Page not found" body in the
 *     same PlatformShell the rest of the app uses (sidebar, top
 *     bar, theme, palette, RSC healing). Users keep their
 *     orientation and can click anywhere on the sidebar to
 *     recover.
 *   - Signed out: minimal centered card on top of `page-bg` so it
 *     still picks up the theme tokens (background, foreground,
 *     border) instead of looking like raw HTML. The middleware
 *     usually redirects unauth'd traffic to /login before it lands
 *     here, but a deeplinked 404 with no session is possible.
 *
 * Note: there's also a `(platform)/not-found.tsx` that fires for
 * "the record doesn't exist" cases inside platform routes — that
 * one is rendered by the platform layout so it inherits the shell
 * automatically. This file is the catch-all for routes that fall
 * outside the (platform) segment entirely.
 */
// `auth()` is per-request — opt out of static generation so the
// session-aware branch always runs at request time.
export const dynamic = "force-dynamic";

function NotFoundBody() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center p-6">
      <div className="max-w-md text-center space-y-3">
        <p className="text-xs font-mono text-muted-foreground">404</p>
        <h1 className="text-xl font-semibold">Page not found</h1>
        <p className="text-sm text-muted-foreground">
          We couldn&rsquo;t find the page you&rsquo;re looking for. The URL might
          be a typo, or the page may have been moved or removed.
        </p>
        <div className="flex justify-center gap-2 pt-2">
          <Link
            href="/dashboard"
            className="inline-flex h-9 items-center rounded border border-primary bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            Go to dashboard
          </Link>
          <Link
            href="/admin"
            className="inline-flex h-9 items-center rounded border border-border bg-card px-3 text-sm font-medium hover:bg-muted/40 transition-colors"
          >
            Open Settings
          </Link>
        </div>
      </div>
    </div>
  );
}

export default async function GlobalNotFound() {
  const session = await auth();
  if (session?.user) {
    return (
      <PlatformShell>
        <NotFoundBody />
      </PlatformShell>
    );
  }

  // Signed-out fallback: theme-aware centered card. We still get
  // the ThemeProvider from the root layout so background/foreground
  // tokens apply.
  return (
    <div className="page-bg min-h-screen flex items-center justify-center p-6">
      <div className="max-w-md w-full rounded border border-border bg-card p-6 text-center space-y-3 shadow-sm">
        <p className="text-xs font-mono text-muted-foreground">404</p>
        <h1 className="text-xl font-semibold text-foreground">Page not found</h1>
        <p className="text-sm text-muted-foreground">
          The page you&rsquo;re looking for doesn&rsquo;t exist. Try signing in
          to reach the rest of the app.
        </p>
        <div className="flex justify-center gap-2 pt-2">
          <Link
            href="/login"
            className="inline-flex h-9 items-center rounded border border-primary bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            Sign in
          </Link>
        </div>
      </div>
    </div>
  );
}
