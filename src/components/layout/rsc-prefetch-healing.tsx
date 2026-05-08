"use client";

import { useEffect } from "react";

/** A wrapped fetch carries a marker so we don't double-install. */
type MarkedFetch = typeof window.fetch & { __rscHealingInstalled?: boolean };

/**
 * RSC prefetch / payload retry shim.
 *
 * Real-environment QA flagged a 503 storm on Next.js Link prefetches:
 * /<route>?_rsc=<hash> intermittently returns 503 Service Unavailable.
 * Same URL succeeds on retry. Symptom is upstream load-shedding (CDN
 * / WAF / edge), not a code path we can fix in the app — but the
 * client-visible side effect is the dreaded "An error occurred in
 * the Server Components render" overlay because the RSC payload
 * fetch surfaces the failure as a render error.
 *
 * This shim wraps the global `fetch` and retries 503 responses up to
 * MAX_ATTEMPTS - 1 times with exponential backoff for any request
 * that looks like an RSC payload fetch. Retries are invisible to
 * call sites — Next's prefetcher and router both await the wrapped
 * fetch and don't know the original 503 happened.
 *
 * Round-4 QA upped the retry budget after a "5x 503 → 1x 200 → 5x
 * 503" pattern leaked through Chunk J's single-retry shim. The
 * current load-shedder behavior absorbs ~70% of GETs in bursts; one
 * retry doesn't cover bursts of that size, so we now do up to four
 * total attempts with jittered exponential backoff (~150ms, 400ms,
 * 900ms between attempts). Total worst-case wait: ~1.5s, well under
 * the user's "perceptible jank" threshold for navigation.
 *
 * POSTs are intentionally NOT retried even on 503. Server actions
 * are not idempotent at the protocol level; the QA report saw
 * cases where the action had run successfully (record visible in
 * the DB) but the gateway returned 503 anyway. Retrying that would
 * create a duplicate. The error boundary's auto-recovery handles
 * the user-visible toast when a server action 503s.
 *
 * Heuristic for "this is an RSC fetch":
 *   - URL has `?_rsc=` query param, OR
 *   - request init carries `RSC: '1'` header (Next 14 router), OR
 *   - request init carries `Next-Router-State-Tree` (prefetch)
 *
 * Wrapping is per-window (idempotent — installs once per mount).
 * Restores the original fetch on unmount so HMR doesn't compound
 * the wrap.
 */
const MAX_ATTEMPTS = 4;
const BACKOFF_BASE_MS = 100;

export function RSCPrefetchHealing() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    const originalFetch = window.fetch;

    // Idempotency guard — if HMR or another mount already installed
    // the wrap, don't double-wrap.
    if ((originalFetch as MarkedFetch).__rscHealingInstalled) return;

    function methodOf(input: RequestInfo | URL, init?: RequestInit): string {
      if (init?.method) return init.method.toUpperCase();
      if (input instanceof Request) return input.method.toUpperCase();
      return "GET";
    }

    function isRscRequest(input: RequestInfo | URL, init?: RequestInit): boolean {
      // URL string check
      const urlStr =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : (input as Request).url;
      if (urlStr.includes("?_rsc=") || urlStr.includes("&_rsc=")) return true;

      // Header check — case-insensitive scan over both the init and
      // (when input is a Request) the request's headers.
      const headerSets: HeadersInit[] = [];
      if (init?.headers) headerSets.push(init.headers);
      if (input instanceof Request) headerSets.push(input.headers);
      for (const h of headerSets) {
        if (h instanceof Headers) {
          if (
            h.get("RSC") === "1" ||
            h.get("rsc") === "1" ||
            h.has("next-router-state-tree") ||
            h.has("next-router-prefetch")
          ) {
            return true;
          }
        } else if (Array.isArray(h)) {
          for (const [k, v] of h) {
            const kl = k.toLowerCase();
            if (kl === "rsc" && v === "1") return true;
            if (kl === "next-router-state-tree" || kl === "next-router-prefetch") return true;
          }
        } else if (h && typeof h === "object") {
          for (const k of Object.keys(h)) {
            const kl = k.toLowerCase();
            const v = (h as Record<string, string>)[k];
            if (kl === "rsc" && v === "1") return true;
            if (kl === "next-router-state-tree" || kl === "next-router-prefetch") return true;
          }
        }
      }
      return false;
    }

    function backoffMs(attemptIndex: number): number {
      // attemptIndex 1 → ~150ms, 2 → ~400ms, 3 → ~900ms
      const base = BACKOFF_BASE_MS * Math.pow(2, attemptIndex);
      const jitter = Math.floor(Math.random() * BACKOFF_BASE_MS);
      return base + jitter;
    }

    const wrappedFetch: typeof window.fetch = async (input, init) => {
      // Only retry GETs / HEADs that look like RSC fetches. POSTs and
      // other mutating verbs are intentionally untouched — see the
      // module doc comment for why.
      const method = methodOf(input, init);
      const isRetryable =
        (method === "GET" || method === "HEAD") && isRscRequest(input, init);
      if (!isRetryable) {
        return originalFetch(input, init);
      }

      // Wrap into a Request so we can clone for each retry. Native
      // Request bodies are single-use; clone() creates a fresh stream.
      // GETs have no body so this is cheap.
      const baseRequest =
        input instanceof Request ? input : new Request(input as string | URL, init);

      let lastResp: Response | null = null;
      for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        try {
          const req = baseRequest.clone();
          lastResp = await originalFetch(req);
          if (lastResp.status !== 503) return lastResp;
          if (attempt < MAX_ATTEMPTS - 1) {
            await new Promise((resolve) => setTimeout(resolve, backoffMs(attempt)));
          }
        } catch (err) {
          // Network errors propagate untouched on the last attempt.
          // Earlier attempts retry through the same backoff path.
          if (attempt === MAX_ATTEMPTS - 1) throw err;
          await new Promise((resolve) => setTimeout(resolve, backoffMs(attempt)));
        }
      }
      // All attempts 503'd — return the last response so the caller
      // sees the upstream error rather than a synthetic one.
      return lastResp!;
    };

    (wrappedFetch as MarkedFetch).__rscHealingInstalled = true;
    window.fetch = wrappedFetch;

    return () => {
      // Best-effort restore. Another component or extension may have
      // re-wrapped fetch in the meantime — only restore if our wrap
      // is still the active one.
      if (window.fetch === wrappedFetch) {
        window.fetch = originalFetch;
      }
    };
  }, []);

  return null;
}
