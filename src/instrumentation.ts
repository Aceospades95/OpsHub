/**
 * Next.js instrumentation hook.
 *
 * Two responsibilities:
 *   1. `register()` — runs once per server boot. Used here for any
 *      observability setup we want to do BEFORE the app starts
 *      handling requests. Currently a no-op; the placeholder exists
 *      so we don't have to add the file from scratch when we need it.
 *   2. `onRequestError(err, request, context)` — runs on every error
 *      that bubbles to the framework boundary. We log a structured
 *      record so production has a fingerprint (handler / runtime /
 *      digest) every time a 5xx is returned. The R10-5 RSC 503
 *      investigation was painful precisely because the old logs
 *      only showed the error object, not which RSC handler it
 *      came from.
 *
 * R11-G adds the onRequestError logger as part of fixing the RSC
 * 503 storm. R11-E reduced the leading-suspect cause (oversized
 * Edge bundle); R11-G hardens the Prisma singleton (src/lib/db.ts)
 * and adds this fingerprinting so the next 5xx in production
 * shows up in the log aggregator with enough context to triage
 * without re-running R10's bisect.
 */

export async function register() {
  // No-op for now. If we later want OpenTelemetry, Sentry, or
  // similar wiring, it lands here. Keeping the function present so
  // adding instrumentation later is a one-file edit.
}

export async function onRequestError(
  err: unknown,
  request: {
    path?: string;
    method?: string;
    headers?: Record<string, string | string[] | undefined>;
  },
  context: {
    routerKind?: string;
    routePath?: string;
    routeType?: string;
    renderSource?: string;
    revalidateReason?: string;
    renderType?: string;
  }
): Promise<void> {
  // Pull the logger lazily so this file stays Edge-safe — the
  // instrumentation hook can run in either runtime depending on
  // route. log.ts is plain ESM with no Node-only deps, so the
  // dynamic import is just import-cost insurance.
  const { log } = await import("@/lib/log");
  log.error("instrumentation.requestError", "request errored", err, {
    method: request.method,
    path: request.path,
    routerKind: context.routerKind,
    routePath: context.routePath,
    routeType: context.routeType,
    renderSource: context.renderSource,
    renderType: context.renderType,
  });
}
