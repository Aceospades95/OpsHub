import { describe, it, expect, beforeEach, vi } from "vitest";

import {
  consume,
  clientIpFromRequest,
  _testMemoryStorage,
} from "./rate-limit";

beforeEach(() => {
  // Each test gets a fresh memory map.
  _testMemoryStorage.clear?.();
  vi.useRealTimers();
});

describe("consume — token bucket basics", () => {
  it("allows the first call and decrements remaining", () => {
    const r = consume("k1", { capacity: 3, refillRatePerSec: 1 });
    expect(r.allowed).toBe(true);
    expect(r.remaining).toBe(2);
    expect(r.retryAfterMs).toBe(0);
  });

  it("allows up to capacity in a burst, then blocks", () => {
    const opts = { capacity: 3, refillRatePerSec: 1 };
    expect(consume("k2", opts).allowed).toBe(true);
    expect(consume("k2", opts).allowed).toBe(true);
    expect(consume("k2", opts).allowed).toBe(true);
    const blocked = consume("k2", opts);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterMs).toBeGreaterThan(0);
  });

  it("refills tokens over time at the declared rate", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));

    const opts = { capacity: 2, refillRatePerSec: 1 };
    expect(consume("k3", opts).allowed).toBe(true);
    expect(consume("k3", opts).allowed).toBe(true);
    expect(consume("k3", opts).allowed).toBe(false);

    // Wait 1.1 seconds — about 1 token's worth.
    vi.setSystemTime(new Date("2026-01-01T00:00:01.100Z"));
    expect(consume("k3", opts).allowed).toBe(true);
    expect(consume("k3", opts).allowed).toBe(false);
  });

  it("never accrues beyond capacity over a long idle", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const opts = { capacity: 2, refillRatePerSec: 1 };
    consume("k4", opts);

    // Idle for an hour — naive accrual would mint 3600 tokens.
    vi.setSystemTime(new Date("2026-01-01T01:00:00Z"));
    expect(consume("k4", opts).allowed).toBe(true);
    expect(consume("k4", opts).allowed).toBe(true);
    expect(consume("k4", opts).allowed).toBe(false);
  });

  it("scales the cost when caller asks for more than 1 token", () => {
    const opts = { capacity: 3, refillRatePerSec: 1 };
    expect(
      consume("k5", { ...opts, cost: 3 }).allowed
    ).toBe(true);
    // Bucket is now 0; cost-2 call should fail.
    expect(consume("k5", { ...opts, cost: 2 }).allowed).toBe(false);
  });

  it("isolates buckets by key", () => {
    const opts = { capacity: 1, refillRatePerSec: 1 };
    expect(consume("a", opts).allowed).toBe(true);
    expect(consume("a", opts).allowed).toBe(false);
    // Different key has its own full bucket.
    expect(consume("b", opts).allowed).toBe(true);
  });

  it("retryAfterMs is roughly proportional to the deficit", () => {
    const opts = { capacity: 1, refillRatePerSec: 2 }; // 1 token per 500ms
    expect(consume("k6", opts).allowed).toBe(true);
    const blocked = consume("k6", opts);
    expect(blocked.allowed).toBe(false);
    // 1-token deficit at 2 tokens/sec → ~500ms. Allow a generous
    // tolerance because the previous call consumed minor real time.
    expect(blocked.retryAfterMs).toBeGreaterThanOrEqual(450);
    expect(blocked.retryAfterMs).toBeLessThanOrEqual(550);
  });
});

describe("clientIpFromRequest", () => {
  function reqWith(headers: Record<string, string>): Request {
    return new Request("http://localhost/", { headers });
  }

  it("uses the leftmost x-forwarded-for entry", () => {
    expect(clientIpFromRequest(reqWith({ "x-forwarded-for": "203.0.113.5, 10.0.0.1, 127.0.0.1" })))
      .toBe("203.0.113.5");
  });

  it("falls back to x-real-ip when x-forwarded-for is absent", () => {
    expect(clientIpFromRequest(reqWith({ "x-real-ip": "203.0.113.7" })))
      .toBe("203.0.113.7");
  });

  it('returns "remote" when no proxy headers are set', () => {
    expect(clientIpFromRequest(reqWith({}))).toBe("remote");
  });

  it("ignores proxy headers when RATE_LIMIT_TRUST_PROXY=false", () => {
    const prev = process.env.RATE_LIMIT_TRUST_PROXY;
    process.env.RATE_LIMIT_TRUST_PROXY = "false";
    try {
      expect(
        clientIpFromRequest(reqWith({ "x-forwarded-for": "203.0.113.5" }))
      ).toBe("remote");
    } finally {
      process.env.RATE_LIMIT_TRUST_PROXY = prev;
    }
  });
});
