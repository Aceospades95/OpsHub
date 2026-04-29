/**
 * Token-bucket rate limiter.
 *
 * Tiny, no-deps, in-memory implementation suitable for a single-process
 * deploy (Unraid, single-container ECS task). The interface accepts a
 * `Storage` so a multi-instance deploy can later swap in a Redis-backed
 * implementation without touching the call sites.
 *
 * Why a token bucket and not a fixed window:
 *   - Fixed windows let a burst of N requests at second 59 followed by
 *     another N at second 0 sneak past as 2N within milliseconds.
 *   - Token buckets allow short bursts (the bucket capacity) while
 *     enforcing a sustained rate (the refill rate). Better UX without
 *     widening the worst-case load.
 *
 * Memory shape: a single Map keyed by the rule's key (e.g. an IP
 * address, a portal token, a userId). Each entry is a small struct so
 * 10k concurrent keys cost ~1 MB. A periodic sweep prunes idle keys
 * — without it the map would grow unbounded over a long uptime.
 *
 * Failure mode: if the storage call ever throws, `consume` returns
 * `{ allowed: true }` (fail open). The rate limiter is a best-effort
 * defense; a single missed limit is preferable to taking down the
 * endpoint when the limiter itself misbehaves.
 */

import { log } from "@/lib/log";

export interface ConsumeOptions {
  /** Max tokens the bucket can hold. Burst size. */
  capacity: number;
  /** Tokens added per second. Sustained rate. */
  refillRatePerSec: number;
  /** How many tokens this call costs. Default 1. */
  cost?: number;
}

export interface ConsumeResult {
  allowed: boolean;
  /** Tokens left after this call. -1 when storage errored. */
  remaining: number;
  /** ms until next token is available. Always 0 when allowed. */
  retryAfterMs: number;
}

interface Bucket {
  tokens: number;
  lastRefillMs: number;
  /** Last time the bucket was touched. Used by the sweep to expire
   *  idle entries. */
  lastUsedMs: number;
}

export interface Storage {
  get(key: string): Bucket | undefined;
  set(key: string, bucket: Bucket): void;
  /** Drop entries whose lastUsedMs is older than `cutoffMs`. */
  sweep(cutoffMs: number): number;
  /** Test helper — clear everything. */
  clear?(): void;
}

class MemoryStorage implements Storage {
  private map = new Map<string, Bucket>();

  get(key: string): Bucket | undefined {
    return this.map.get(key);
  }

  set(key: string, bucket: Bucket): void {
    this.map.set(key, bucket);
  }

  sweep(cutoffMs: number): number {
    let removed = 0;
    for (const [k, v] of Array.from(this.map.entries())) {
      if (v.lastUsedMs < cutoffMs) {
        this.map.delete(k);
        removed++;
      }
    }
    return removed;
  }

  clear(): void {
    this.map.clear();
  }
}

const memoryStorage = new MemoryStorage();
let activeStorage: Storage = memoryStorage;

/**
 * Inject a different storage backend (e.g. a Redis client wrapper).
 * Default is in-memory. Returns the previous backend so a test can
 * restore it.
 */
export function setStorage(storage: Storage): Storage {
  const prev = activeStorage;
  activeStorage = storage;
  return prev;
}

/**
 * Periodic background sweep. Idle entries (no `consume` for the
 * last hour) are pruned so the map doesn't grow unbounded over a
 * months-long uptime. Cheap — a Map iteration on N entries is
 * O(N) and we run it on a 5-minute interval.
 *
 * No-op when running under vitest (the timer would prevent the
 * process from exiting cleanly between tests).
 */
const IDLE_TTL_MS = 60 * 60 * 1000; // 1h
const SWEEP_INTERVAL_MS = 5 * 60 * 1000; // 5m
if (typeof process !== "undefined" && process.env.VITEST !== "true" && process.env.NODE_ENV !== "test") {
  setInterval(() => {
    try {
      const removed = activeStorage.sweep(Date.now() - IDLE_TTL_MS);
      if (removed > 0) {
        log.debug("rate-limit.sweep", "Pruned idle buckets", { removed });
      }
    } catch (err) {
      log.error("rate-limit.sweep", "Sweep failed", err);
    }
  }, SWEEP_INTERVAL_MS).unref?.();
}

/**
 * Try to consume `cost` tokens from the bucket identified by `key`.
 * Returns `allowed: true` when the bucket had enough tokens; `false`
 * with `retryAfterMs` indicating when the next attempt could succeed.
 */
export function consume(key: string, opts: ConsumeOptions): ConsumeResult {
  const cost = opts.cost ?? 1;
  const now = Date.now();

  let bucket: Bucket | undefined;
  try {
    bucket = activeStorage.get(key);
  } catch (err) {
    // Fail open. A single missed limit is better than a 500.
    log.error("rate-limit.consume", "Storage get failed; allowing", err, { key });
    return { allowed: true, remaining: -1, retryAfterMs: 0 };
  }

  if (!bucket) {
    // First touch: bucket starts full so the first request is never
    // delayed. Common case for an isolated client.
    bucket = {
      tokens: opts.capacity,
      lastRefillMs: now,
      lastUsedMs: now,
    };
  } else {
    // Refill based on elapsed time since last refill. Cap at capacity
    // so a long-idle bucket doesn't accumulate tokens beyond the burst
    // ceiling.
    const elapsedSec = (now - bucket.lastRefillMs) / 1000;
    const replenish = elapsedSec * opts.refillRatePerSec;
    bucket = {
      tokens: Math.min(opts.capacity, bucket.tokens + replenish),
      lastRefillMs: now,
      lastUsedMs: now,
    };
  }

  if (bucket.tokens >= cost) {
    bucket.tokens -= cost;
    try {
      activeStorage.set(key, bucket);
    } catch (err) {
      log.error("rate-limit.consume", "Storage set failed; allowing", err, { key });
    }
    return {
      allowed: true,
      remaining: Math.floor(bucket.tokens),
      retryAfterMs: 0,
    };
  }

  // Not enough tokens. Persist the refilled bucket (so subsequent
  // calls see the partial accrual) and tell the caller how long to
  // wait for the next single token.
  try {
    activeStorage.set(key, bucket);
  } catch (err) {
    log.error("rate-limit.consume", "Storage set failed; allowing", err, { key });
    return { allowed: true, remaining: -1, retryAfterMs: 0 };
  }

  const deficit = cost - bucket.tokens;
  const retryAfterMs = Math.ceil((deficit / opts.refillRatePerSec) * 1000);
  return {
    allowed: false,
    remaining: 0,
    retryAfterMs,
  };
}

/**
 * Best-effort client-IP extractor for Next.js Request objects.
 *
 * Behind a load balancer (ALB, nginx, Cloudflare) the real client IP
 * lives in `x-forwarded-for` — usually a comma-separated list with the
 * client first and intermediate proxies trailing. We trust the leftmost
 * value. Behind a direct connection (local dev) we fall back to a
 * literal "local" so the rate-limit key still makes sense.
 *
 * Spoofable when the deploy isn't behind a trusted proxy. If you're
 * exposing this to the internet without a proxy, set
 * RATE_LIMIT_TRUST_PROXY="false" so the limiter uses just "remote"
 * and you're at least bucketing all unidentified traffic together.
 */
export function clientIpFromRequest(req: Request): string {
  const trustProxy =
    (process.env.RATE_LIMIT_TRUST_PROXY ?? "true").toLowerCase() !== "false";
  if (trustProxy) {
    const xff = req.headers.get("x-forwarded-for");
    if (xff) {
      const first = xff.split(",")[0]?.trim();
      if (first) return first;
    }
    const real = req.headers.get("x-real-ip");
    if (real) return real.trim();
  }
  return "remote";
}

// Test-only re-exports.
export const _testMemoryStorage = memoryStorage;
