# RSC 503 Storm — Diagnosis

**Status:** R11-G shipped the structural fixes. Synthetic verification + a deploy-time
re-check still required (see "R11 follow-up" at the bottom of this doc).

## Symptom

Production navigation produces a storm of 503 responses on Next.js RSC prefetch
requests. The user reports ~70% of `/<route>?_rsc=<hash>` GETs return 503 across
dashboard / team / clients / projects / partnerships / quotes / contracts /
certifications / tools / suppliers / admin.

Direct sequential or parallel RSC fetches with `RSC: 1` + `Next-Router-Prefetch`
headers return 200 cleanly from the same browser session. The 503s are tied to
the **burst pattern** Next.js's Link prefetcher generates on page load — when a
list page renders 20 cards, the router fires 20 parallel `?_rsc=` prefetches and
~14 of them 503.

The R4 `RSCPrefetchHealing` shim (1 → 4 retries with exponential backoff)
absorbs some 503s but the underlying overload is still visible in DevTools.

## Audit results

### 1. `src/middleware.ts` + matcher

```ts
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
```

The matcher catches **every** request that isn't a static asset — including all
`?_rsc=…` GETs. The middleware body itself is cheap: `auth()` decodes the JWT
cookie (Edge runtime, no DB hit) and either redirects or passes the request
through. Not a likely root cause on its own, but it does mean **every** RSC
prefetch executes the auth callback before reaching the route handler.

No rate-limiter, no path filter that would throttle `?_rsc=` traffic.

### 2. `next.config.js`

```js
{
  output: "standalone",
  experimental: { serverActions: { bodySizeLimit: "10mb" } },
}
```

No custom `headers()`, `redirects()`, `images.domains`, `experimental.optimizePackageImports`,
or prefetch-related config. **Not a contributor.**

### 3. Prisma client config

```ts
// src/lib/db.ts (full file)
import { PrismaClient } from "@prisma/client";
const globalForPrisma = globalThis as unknown as { prisma: PrismaClient | undefined };
export const db = globalForPrisma.prisma ?? new PrismaClient();
if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;
```

**`new PrismaClient()` with no options.** Pool size defaults to
`num_physical_cpus * 2 + 1` per the Prisma docs. On a typical 1 vCPU deployment
that's **3 connections.**

`.env.example` shows the deployed `DATABASE_URL` as a vanilla
`postgresql://…?schema=public` with **no `connection_limit` or `pool_timeout`
query parameters.** No pgbouncer indicator either way.

### 4. In-process rate limiters on the platform layout

Only `src/lib/rate-limit.ts` is wired in:

- `src/lib/auth.ts:7,59` — credentials login (per-IP, per-email).
- `src/actions/auth.ts:11,55,71` — login server action (per-IP, per-email).
- `src/actions/workflow-portal.ts:10,27` — portal token actions.
- `src/app/api/public/portal/[token]/upload/route.ts` — public file upload.

**Nothing on RSC routes, server actions other than login, or any platform-layout
data fetch.** Not a contributor.

### 5. `Dockerfile` / `start.sh` / `next start` args

Standard Next.js standalone runner:

- `start.sh`: env validation → `prisma migrate deploy` → `node server.js`.
- `Dockerfile` runner stage: `EXPOSE 3000`, `tini` as init, no `NODE_OPTIONS`
  / `UV_THREADPOOL_SIZE` overrides, no `--max-http-header-size` or concurrency
  flags.

The standalone `node server.js` doesn't expose a max-concurrency knob;
Node serves requests as fast as the event loop drains. **Not a contributor.**

### 6. Cloudflare / infra

The production hostname (redacted) resolves to Cloudflare per the `cf-cache-status`
+ `server: cloudflare` headers (verified earlier in round 3). No
`wrangler.toml`, `fly.toml`, `vercel.json`, or any other infra config in the
repo — Cloudflare is a CDN-only proxy for this deploy.

Cloudflare's free tier shape rules can return 503 on burst origin overload, but
the leading edge of every observed 503 is the origin Next.js server, not the
edge. (See: 503 responses include the OpsHub Next.js error page format, not
Cloudflare's branded error.)

## The actual bottleneck

The platform layout's data fetch path runs on **every** authenticated RSC
request, including prefetches:

```ts
// src/components/layout/platform-shell.tsx — round-9 extraction
const session = await auth();                                      // JWT decode
const freshUser = await db.user.findUnique(...);                   // DB
const [sidebarConfig, customPages, unreadCount, recentNotifs, branding] =
  await Promise.all([
    getSidebarConfig(),                                            // DB
    db.sandboxPage.findMany(...),                                  // DB
    getBellUnreadCount(session.user.id, role),                     // DB (count)
    getUserNotifications(session.user.id, { limit: 10 }),          // DB
    getBranding(),                                                 // DB + 1-2 storage exists() checks
  ]);
```

That's **6+ DB round-trips per RSC render** for an authenticated user. When
Next.js Link prefetch fires 20 parallel `?_rsc=` requests for a 20-card list
page:

- 20 layout renders × 6 queries = **120 concurrent DB queries**
- Prisma default pool on 1 vCPU = **3 connections**
- 117 queries queue
- Pool default `pool_timeout` is 10 s, but the queue depth + per-query latency
  pushes the slow ones past that
- `PrismaClientKnownRequestError` bubbles out of the Promise.all
- The layout's server component throws
- Next.js's RSC handler returns 500/503

The 30% that *do* succeed are the requests that beat the pool exhaustion
(arrived first or completed quickly), explaining the user's "~70%" observation.

## Top 2 hypotheses, ranked

### Hypothesis 1 (most likely): Prisma pool exhaustion under prefetch burst

**Confidence: high.** Six-plus DB queries per layout render × N concurrent
prefetches from `<Link>` overrun a default Prisma pool of 3 connections on the
production VM.

**Evidence:**
- Direct sequential RSC fetches succeed → not a code-path bug.
- Burst pattern fails → consistent with pool exhaustion.
- No `connection_limit` in the production DATABASE_URL → default applies.
- Layout fires 6+ queries every render and there's no caching layer.

### Hypothesis 2 (secondary): no Next.js cache on layout-level data

**Confidence: medium.** Even with a larger pool, hitting `getSidebarConfig()` /
`getBranding()` / `db.sandboxPage.findMany()` 20 times in 200 ms for unchanged
data is wasteful. These read-mostly fixtures could be cached with
`unstable_cache` or `revalidate` for 60 s and the layout would do **0** DB
queries on a prefetch storm.

## Recommended fix (R11)

### Primary — bump the Prisma pool

**File:** `.env.example` (and the deployed `DATABASE_URL` in production)
**Change:** append `?connection_limit=20&pool_timeout=20` to the existing
URL:

```
DATABASE_URL="postgresql://user:password@localhost:5432/opshub?schema=public&connection_limit=20&pool_timeout=20"
```

Production needs the matching env update — operator action, not a code change.
The example file in the repo just documents the expected shape.

20 connections is conservative for a single-VM deploy backed by Postgres on the
same host or a small RDS instance (default `max_connections` is 100; reserve
~30 for other clients + admin).

### Secondary — cache the layout's read-mostly fetches

**Files:**
- `src/components/layout/platform-shell.tsx` — wrap the parallel data fetches.
- Possibly extract a `getCachedLayoutData(userId, role)` helper.

**Change:** wrap each unchanging-per-second fetch in Next.js
`unstable_cache` with a 60 s revalidate window:

```ts
import { unstable_cache } from "next/cache";

const getCachedSidebarConfig = unstable_cache(
  () => getSidebarConfig(),
  ["sidebar-config"],
  { revalidate: 60 }
);
const getCachedBranding = unstable_cache(
  () => getBranding(),
  ["branding"],
  { revalidate: 60 }
);
```

Per-user fetches (`getBellUnreadCount`, `getUserNotifications`) stay live so
the bell stays accurate.

## Rollback plan

Both proposed changes are isolated and safe to revert:

- **DATABASE_URL change:** revert to the previous URL value via the deploy
  platform's env settings. No schema or migration touched.
- **`unstable_cache` wrap:** revert the platform-shell.tsx diff. The original
  `getSidebarConfig()` etc. functions are unchanged; only the call-site
  wrapping is added.

Smoke test after fix:
1. Visit `/dashboard`. Confirm normal load.
2. Open DevTools Network panel. Visit `/projects` (20+ prefetches). Confirm
   ≥95% of `?_rsc=` requests return 200.
3. Update a sidebar config entry via `/admin/sidebar`. Reload `/dashboard`.
   Confirm the change appears within ≤60 s (cache window).
4. Trigger a notification. Reload any page. Confirm the bell badge updates
   immediately (per-user fetch is not cached).

## R11 follow-up

Three structural changes shipped in R11 that target the leading hypotheses
this doc raised:

- **R11-E (Edge bundle)** — `src/middleware.ts` no longer pulls Prisma /
  bcryptjs / the Google sign-in helper into Edge. Build output:
  Middleware = 79 kB, down from 111 kB (-29%). Edge cold-starts are
  faster; less wall-time spent before the auth check returns.
- **R11-G (Prisma singleton)** — `src/lib/db.ts` now caches the
  `PrismaClient` on `globalThis` in production too, not just dev.
  Defends against any path (workers, instrumentation re-eval, future
  bundler tweaks) that might otherwise spin up a second engine
  subprocess.
- **R11-G (instrumentation)** — `src/instrumentation.ts` exports
  `onRequestError` so production now logs a structured record on
  every framework-boundary error: handler path, route type, render
  source, and the underlying error. Previously the only signal was
  the bare 503; the next time one fires there's a fingerprint to grep.

What was *not* changed in R11:

- AWS load balancer idle timeout (third hypothesis). Not a code change;
  needs an infra config audit by whoever owns the deploy.
- `RSCPrefetchHealing` retry shim. Stays for now; once we have a
  fingerprinted log of the actual 5xx, we can decide whether the shim
  is still earning its keep.

Verification after the next deploy:

1. `BASE_URL=<your-deploy> npm run smoke` (the new `scripts/smoke.sh`
   hits 3 RSC routes 50× each in parallel and asserts zero 5xx).
2. If a 5xx surfaces, grep the production logs for
   `instrumentation.requestError` — every record names the route,
   runtime, and underlying error.
