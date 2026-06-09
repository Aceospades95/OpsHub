"use client";

import { useEffect } from "react";

/**
 * Root error boundary — covers everything outside the (platform)
 * group: /login, /register, /signup/[token], /portal/[token]. Without
 * this file those routes fell back to Next's unstyled default error
 * screen. Kept deliberately simpler than (platform)/error.tsx: there
 * is no session here, so no dashboard link and no RSC auto-recovery
 * (the healing shim only mounts inside the platform shell).
 */
export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // eslint-disable-next-line no-console
    console.error("Root error boundary caught:", error);
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="max-w-md text-center space-y-3">
        <h2 className="text-xl font-semibold text-foreground">
          Something went wrong
        </h2>
        <p className="text-sm text-muted-foreground">
          An unexpected error occurred. Try again, and if the problem
          persists contact your administrator.
        </p>
        {error.digest && (
          <p className="text-xs text-muted-foreground/70">
            Error ID: <code className="font-mono">{error.digest}</code>
          </p>
        )}
        <div className="pt-2">
          <button
            onClick={reset}
            className="inline-flex h-9 items-center rounded border border-primary bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            Try again
          </button>
        </div>
      </div>
    </div>
  );
}
