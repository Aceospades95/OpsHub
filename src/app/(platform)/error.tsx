"use client";

import { useEffect } from "react";
import Link from "next/link";

/**
 * Defensive error boundary for the authenticated platform. Without this
 * file, an unexpected throw in any platform Server Component bubbles to
 * the root error.tsx (or the framework's stripped-in-production "An
 * error occurred in the Server Components render. The specific message
 * is omitted in production builds…" message). With it, the user sees a
 * recognizable inline error and can keep navigating.
 *
 * Notes:
 *   - Must be a Client Component (Next.js requirement for error.tsx).
 *   - In Next.js 14, NEXT_REDIRECT and NEXT_NOT_FOUND are handled by
 *     the framework before reaching this boundary, so there's no need
 *     to manually re-throw them here. The guard below is a no-op on
 *     current Next, but cheap insurance against a regression.
 */
export default function PlatformError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  // Re-throw redirects / not-found errors so the framework still
  // routes them. Older Next versions had bugs where these reached
  // error.tsx; this guard keeps us safe on a downgrade.
  if (
    error.message === "NEXT_REDIRECT" ||
    error.message === "NEXT_NOT_FOUND"
  ) {
    throw error;
  }

  useEffect(() => {
    // Surface the digest in dev tools / monitoring. Production builds
    // strip the message, but the digest is enough to correlate with
    // server logs.
    // eslint-disable-next-line no-console
    console.error("Platform error boundary caught:", error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] items-center justify-center p-6">
      <div className="max-w-md text-center space-y-3">
        <h2 className="text-xl font-semibold">Something went wrong</h2>
        <p className="text-sm text-muted-foreground">
          An unexpected error occurred on this page. If you just deleted or
          renamed a record, the page may be out of sync — try reloading.
        </p>
        {error.digest && (
          <p className="text-xs text-muted-foreground/70">
            Error ID: <code className="font-mono">{error.digest}</code>
          </p>
        )}
        <div className="flex justify-center gap-2 pt-2">
          <button
            onClick={reset}
            className="inline-flex h-9 items-center rounded border border-border bg-muted px-3 text-sm font-medium hover:bg-muted/80 transition-colors"
          >
            Try again
          </button>
          <Link
            href="/dashboard"
            className="inline-flex h-9 items-center rounded border border-primary bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            Go to dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}
