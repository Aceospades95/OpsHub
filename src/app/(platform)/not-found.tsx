import Link from "next/link";

/**
 * Friendly 404 boundary for the authenticated platform routes. Without
 * this file Next.js falls back to its built-in 404 — fine for direct
 * navigation, but the same surface gets rendered when a server action
 * deletes a record while the user is on its detail page (the action
 * triggers an RSC refresh, the page calls notFound(), and the resulting
 * UI is what they see for a beat before the client navigates away).
 *
 * See revalidate-entity.ts for the matching `deleted` flag in
 * revalidateProject / revalidateClient / etc. that prevents the auto-
 * refresh from happening in the first place; this file is the
 * defensive backstop for the cases the flag doesn't cover.
 */
export default function NotFound() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center p-6">
      <div className="max-w-md text-center space-y-3">
        <p className="text-xs font-mono text-muted-foreground">404</p>
        <h2 className="text-xl font-semibold">Not found</h2>
        <p className="text-sm text-muted-foreground">
          This record may have been deleted, archived, or you don&rsquo;t have
          access. Try heading back to the page you came from.
        </p>
        <div className="flex justify-center gap-2 pt-2">
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
