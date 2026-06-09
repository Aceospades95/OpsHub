/**
 * Route-segment loading skeleton: page-title bar + three pulsing card
 * blocks. Pure presentational — keep it dependency-free so the segment
 * can stream instantly.
 */
export default function Loading() {
  return (
    <div className="animate-pulse">
      <div className="mb-8 space-y-2">
        <div className="h-8 w-48 rounded bg-muted" />
        <div className="h-4 w-72 rounded bg-muted" />
      </div>
      <div className="space-y-4">
        <div className="h-32 rounded-lg bg-muted" />
        <div className="h-32 rounded-lg bg-muted" />
        <div className="h-32 rounded-lg bg-muted" />
      </div>
    </div>
  );
}
