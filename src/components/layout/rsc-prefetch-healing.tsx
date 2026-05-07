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
 * This shim wraps the global `fetch` and retries 503 responses ONCE
 * with jitter for any request that looks like an RSC payload fetch.
 * The retry is invisible to call sites — Next's prefetcher and
 * router both await the wrapped fetch and don't know the original
 * 503 happened. After the retry, if the second attempt also 503s,
 * we let the failure propagate as before; the upstream issue is
 * real and the user should know.
 *
 * Heuristic for "this is an RSC fetch":
 *   - URL has `?_rsc=` query param, OR
 *   - request init carries `RSC: '1'` header (Next 14 router)
 *   - request init carries `Next-Router-State-Tree` (prefetch)
 *
 * Wrapping is per-window (idempotent — installs once per mount).
 * Restores the original fetch on unmount so HMR doesn't compound
 * the wrap.
 */
export function RSCPrefetchHealing() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    const originalFetch = window.fetch;

    // Idempotency guard — if HMR or another mount already installed
    // the wrap, don't double-wrap.
    if ((originalFetch as MarkedFetch).__rscHealingInstalled) return;

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

    const wrappedFetch: typeof window.fetch = async (input, init) => {
      // Fast path for non-RSC requests — pass straight through.
      if (!isRscRequest(input, init)) {
        return originalFetch(input, init);
      }

      try {
        const first = await originalFetch(input, init);
        if (first.status !== 503) return first;

        // 503 — retry once with jittered backoff.
        const delayMs = 80 + Math.floor(Math.random() * 240); // 80-320ms
        await new Promise((resolve) => setTimeout(resolve, delayMs));

        // Re-issue. If `input` is a consumed Request, clone it; native
        // Request bodies are single-use.
        const retryInput =
          input instanceof Request ? input.clone() : input;
        return originalFetch(retryInput, init);
      } catch (err) {
        // Network errors propagate untouched.
        throw err;
      }
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
