"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

/**
 * Defensive error boundary for the authenticated platform.
 *
 * Two failure modes are auto-recovered before showing UI:
 *
 *   1. RSC prefetch / payload failures — manifest as the
 *      "Server Components render" message in production builds.
 *      Always transient (upstream load-shedding); we wait one tick,
 *      call router.refresh() + reset(), and only fall through to
 *      the user-visible UI if the auto-recovery also fails. The
 *      RSC prefetch healing shim
 *      (src/components/layout/rsc-prefetch-healing.tsx) catches
 *      most of these at the fetch layer; this is the second-line
 *      backup that prevents the user from seeing the toast at all
 *      for a one-off 503.
 *
 *   2. NEXT_REDIRECT / NEXT_NOT_FOUND — framework handles these
 *      before reaching here on current Next, but older versions
 *      leaked them. Rethrow so they route correctly.
 */

function isLikelyPrefetchError(error: Error & { digest?: string }): boolean {
  // Production stripped-message shape — when the upstream returns 503
  // for an RSC payload, Next surfaces this exact message because the
  // real reason is omitted to avoid leaking server internals.
  if (
    error.message?.includes("Server Components render") ||
    error.message?.includes("Failed to fetch") ||
    error.message?.includes("503") ||
    error.message?.includes("Load failed")
  ) {
    return true;
  }
  // RSC-marker digest prefixes from Next 14.
  if (error.digest?.startsWith("NEXT_RSC_") || error.digest?.includes("RSC")) {
    return true;
  }
  return false;
}

export default function PlatformError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  if (
    error.message === "NEXT_REDIRECT" ||
    error.message === "NEXT_NOT_FOUND"
  ) {
    throw error;
  }

  const router = useRouter();
  // Track auto-recovery so a legitimately-broken page doesn't loop.
  const [autoRecoveryAttempted, setAutoRecoveryAttempted] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line no-console
    console.error("Platform error boundary caught:", error);

    if (!autoRecoveryAttempted && isLikelyPrefetchError(error)) {
      setAutoRecoveryAttempted(true);
      const t = setTimeout(() => {
        router.refresh();
        reset();
      }, 200);
      return () => clearTimeout(t);
    }
  }, [error, autoRecoveryAttempted, router, reset]);

  // While the auto-recovery is in flight, render nothing so the user
  // never sees the "Something went wrong" toast for a transient hiccup.
  if (!autoRecoveryAttempted && isLikelyPrefetchError(error)) {
    return null;
  }

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
