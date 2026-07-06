/**
 * Route-segment loading skeleton for /fleet — stat chips + card grid.
 * Pure presentational.
 */
export default function Loading() {
  return (
    <div className="animate-pulse">
      <div className="mb-8 space-y-2">
        <div className="h-8 w-48 rounded bg-muted" />
        <div className="h-4 w-72 rounded bg-muted" />
      </div>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 mb-6">
        <div className="h-20 rounded-lg bg-muted" />
        <div className="h-20 rounded-lg bg-muted" />
        <div className="h-20 rounded-lg bg-muted" />
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <div className="h-40 rounded-lg bg-muted" />
        <div className="h-40 rounded-lg bg-muted" />
        <div className="h-40 rounded-lg bg-muted" />
      </div>
    </div>
  );
}
