/**
 * Route-segment loading skeleton for /my — mirrors the two-card row +
 * full-width table shape of the real page. Pure presentational.
 */
export default function Loading() {
  return (
    <div className="animate-pulse">
      <div className="mb-8 space-y-2">
        <div className="h-8 w-48 rounded bg-muted" />
        <div className="h-4 w-72 rounded bg-muted" />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <div className="h-56 rounded-lg bg-muted" />
        <div className="h-56 rounded-lg bg-muted" />
      </div>
      <div className="h-96 rounded-lg bg-muted" />
    </div>
  );
}
