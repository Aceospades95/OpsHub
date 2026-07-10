# OpsHub deployment + operations runbook

This document is the canonical reference for deploying and operating OpsHub. It assumes you've read the README and just need to know **what to set, where to look when something breaks, and how to verify a deploy**.

## Boot sequence

`start.sh` is the container's `CMD`. It runs in this order:

1. **`scripts/validate-env.mjs`** — plain Node script (no Prisma, no TypeScript) that validates required env vars before anything touches the DB. Required vars and conditional rules live there. A failure here exits 1; the container restarts and the orchestrator's restart-loop reveals the misconfiguration.
2. **`prisma migrate deploy`** — applies any pending migrations. Wrapped in a 4× exponential-backoff retry for transient DB connectivity failures (cold RDS, networking blip). If Prisma reports a failed prior migration (`P3009` / `P3018`) the script exits immediately with a recovery message pointing at `npx prisma migrate resolve --applied <name>` — the failed-migration drift that hit the v1 Unraid box manifests as those codes.
3. **`next start`** on `$PORT` (default 3000). Standalone mode — no `next` CLI dependency at runtime.

`tini` is the container ENTRYPOINT so SIGTERM from `docker stop` / ECS task drain reaches Node cleanly without the 10s SIGKILL escape hatch.

## Health endpoints

| Endpoint | Purpose | Auth | Rate limit |
| --- | --- | --- | --- |
| `GET /api/health` | Liveness — orchestrator probes. `200 {status:"ok"}` when DB is reachable. `503` otherwise. | none | none |
| `GET /api/health?check=services` | Verbose probe — DB + email driver + storage driver + cron secret presence. | none | per-IP 5 burst / 6 per minute |
| `GET /api/admin/health/internals` | Per-job last-run status, last-success timestamp, driver names, EmailLog 24h failure count. | ADMIN | inherits NextAuth session |

## Environment variables

All variables are documented in `.env.example` with inline notes; this section calls out the **required** set and the **operational defaults** that matter most.

### Required (every environment)

- `DATABASE_URL` — Postgres connection string. The role must be able to `CREATE TABLE` so `prisma migrate deploy` can run on container boot.
- `NEXTAUTH_URL` — Public base URL. Must match exactly what users hit (scheme + host + port). NextAuth uses it to construct OAuth callbacks.
- `NEXTAUTH_SECRET` — Random ≥ 32-char secret. Each env (dev / staging / prod) gets its own.

### Required in production

- `CRON_SECRET` — Shared secret on the `x-cron-secret` header for `POST /api/jobs/run`. Without it, every scheduled job silently never fires (the route returns 401 to all callers).
- `EMAIL_DRIVER` — Must be `ses` or `smtp`. The boot validator rejects `log` in production unless `ALLOW_LOG_DRIVER_IN_PROD=true` is also set (an explicit override for staging environments that genuinely don't need outbound mail).
- `EMAIL_FROM` — Verified sender identity matching the chosen driver.

### Operational defaults that matter

| Variable | Default | What changes if you tune it |
| --- | --- | --- |
| `ACTIVITY_LOG_RETENTION_DAYS` | 365 | Audit table size on disk. |
| `JOB_LOG_RETENTION_DAYS` | 90 | Largest table on the box — `workflows-tick` writes one row per minute. |
| `EMAIL_LOG_BODY_RETENTION_DAYS` | 30 | After this, message bodies (`bodyHtml` / `bodyText`) are scrubbed but metadata stays. |
| `EMAIL_LOG_RETENTION_DAYS` | 365 | Hard delete window for the EmailLog row itself. |
| `WORKFLOW_EVENT_RETENTION_DAYS` | 365 | Only purges events whose parent instance is COMPLETED/CANCELLED — in-flight instances keep their full timeline. |
| `USER_STORAGE_QUOTA_BYTES` | 1073741824 (1 GiB) | Per-user soft cap on uploaded bytes. Set to 0 to disable. |
| `STORAGE_DRIVER` | `local` | **Production must use `s3`** — container filesystems are ephemeral. |
| `RATE_LIMIT_TRUST_PROXY` | `true` | When `false`, the limiter ignores `x-forwarded-for` and buckets all unidentified traffic together. Set `false` only when the deploy isn't behind a trusted proxy. |
| `STUCK_STEP_THRESHOLD_MS` | n/a (compile-time, 15 min) | Watchdog reverts synchronous workflow steps stuck in `IN_PROGRESS` past this. |

## Scheduled jobs

Wire **one** cron entry to `POST /api/jobs/run` (no body, no `?job=` param) at hourly cadence. Every registered job is gated by its own internal cadence (`shouldRunDaily`, `shouldRunWeekly`) so an hourly trigger can drive everything.

Two exceptions:

- **`workflows-tick` should run every minute** — a separate cron entry with `?job=workflows-tick` so subjects don't wait an hour for their next portal step to surface.
- **`google-tasks-sync` should run every ~5 minutes** when anyone has connected Google Tasks (Google has no webhooks, so sync latency = poll cadence). Cheap no-op when nothing changed; the /my "Sync now" button covers on-demand freshness either way.

Vercel-style example:

```jsonc
{
  "crons": [
    { "path": "/api/jobs/run?job=workflows-tick",    "schedule": "* * * * *" },
    { "path": "/api/jobs/run?job=google-tasks-sync", "schedule": "*/5 * * * *" },
    { "path": "/api/jobs/run",                       "schedule": "0 * * * *" }
  ]
}
```

OS cron + curl example:

```cron
* * * * *    curl -fsS -X POST -H "x-cron-secret: $CRON_SECRET" https://opshub.example.com/api/jobs/run?job=workflows-tick
*/5 * * * *  curl -fsS -X POST -H "x-cron-secret: $CRON_SECRET" https://opshub.example.com/api/jobs/run?job=google-tasks-sync
0 * * * *    curl -fsS -X POST -H "x-cron-secret: $CRON_SECRET" https://opshub.example.com/api/jobs/run
```

Registered jobs (from `src/lib/jobs/registry.ts`):

| Key | Cadence | What it does |
| --- | --- | --- |
| `workflows-tick` | every minute | Processes due workflow steps; reverts synchronous steps stuck in `IN_PROGRESS` past the watchdog threshold. |
| `workflow-scheduled-triggers` | daily | Fires `SCHEDULED_DATE` triggers (e.g. offboarding 7 days before termination). |
| `workflow-reminder-digest` | daily | Emails admins a digest of stuck workflow steps + expiring quotes. |
| `contract-expiry-check` | daily | Notifies for contracts approaching renewal. |
| `certification-expiry-check` | daily | Notifies for certs approaching expiry. |
| `daily-reports-digest` | daily | Emails the configured "daily report" recipients their saved reports. |
| `custom-scheduled-tasks` | hourly | Fires admin-defined `ScheduledTask` rows (email-report, email-message). |
| `cleanup-stale-notifications` | weekly | Drops read notifications older than the configured retention. |
| `cleanup-old-activity-logs` | weekly | Drops `ActivityLog` rows past `ACTIVITY_LOG_RETENTION_DAYS`. |
| `cleanup-old-job-logs` | weekly | Drops `JobLog` rows past `JOB_LOG_RETENTION_DAYS` (skips in-flight `running` rows). |
| `cleanup-old-email-logs` | weekly | Two-stage: scrubs bodies after `EMAIL_LOG_BODY_RETENTION_DAYS`, hard-deletes after `EMAIL_LOG_RETENTION_DAYS`. |
| `cleanup-old-workflow-events` | weekly | Drops `WorkflowEvent` rows past `WORKFLOW_EVENT_RETENTION_DAYS` for terminal instances only. |

## Rate limits

| Surface | Bucket | Defaults |
| --- | --- | --- |
| `loginAction` | per-IP | 8 burst / 120 per hour sustained |
| `loginAction` | per-email (lowercased) | 5 burst / 60 per hour sustained |
| `/api/public/portal/[token]/upload` | per-IP | 20 burst / 30 per minute |
| `/api/public/portal/[token]/upload` | per-token | 5 burst / 1 per 30 seconds |
| Portal write actions (signature/form/document/task) | per-token | 10 burst / 10 per minute |
| `/api/health?check=services` | per-IP | 5 burst / 6 per minute |

The in-memory implementation in `src/lib/rate-limit.ts` is fine for a single-process deploy. ECS multi-container needs a Redis-backed `Storage` swap — the interface is defined for that.


## AWS deployment runbook

The move from single-node Unraid to AWS. Everything below is settable
without code changes — the drivers and hooks already exist.

### 1. Image pulls (no PAT on the box)

Two options, in order of preference:

- **ECR + instance role (no stored credentials).** Enable the
  `ecr-publish.yml` workflow by setting three repository *variables*
  (Settings → Secrets and variables → Actions → Variables):
  `AWS_REGION`, `AWS_ROLE_ARN` (an OIDC-trusted role with
  ecr:PutImage etc.), and `ECR_REPOSITORY` (e.g. `opshub`). The job
  no-ops until they're set. On the instance, attach an IAM role with
  `AmazonEC2ContainerRegistryReadOnly` and pull via
  `aws ecr get-login-password | docker login --username AWS --password-stdin <acct>.dkr.ecr.<region>.amazonaws.com`
  (or let ECS handle it — task roles pull natively).
- **GHCR + read-only PAT.** One-time
  `docker login ghcr.io -u <github-user>` with a classic PAT scoped to
  ONLY `read:packages`. Docker caches it; `docker compose pull` works
  unattended afterwards.

### 2. File storage — S3, not the container disk

The default `local` driver writes to `.storage/` INSIDE the container;
replace the instance and every receipt/logo/portal upload is gone.
In AWS set:

```
STORAGE_DRIVER=s3
S3_BUCKET=<bucket>
S3_REGION=<region>
```

Credentials come from the SDK default chain — attach an instance/task
role with read/write on that bucket and set nothing else. Existing
local files do NOT migrate automatically: copy `.storage/files/*` to
the bucket keeping the same keys, or accept starting fresh (the
`File.storageDriver` column keeps old rows readable while both drivers
are reachable).

### 3. Email — pick a real driver

`EMAIL_DRIVER=log` (the default) writes to the EmailLog table and
sends NOTHING — every notification email (bid deadlines, cert expiry,
vehicle maintenance, welcome emails) silently stays in-app. The boot
validator refuses `log` in production for exactly this reason. On AWS
the natural choice is SES:

```
EMAIL_DRIVER=ses
SES_FROM_ADDRESS=ops@yourdomain.com   # a verified SES identity
AWS_REGION=<region>                    # if different from the default chain
```

(Verify the domain in SES, move out of the sandbox, and attach
`ses:SendEmail` to the instance/task role.) `EMAIL_DRIVER=smtp` is the
provider-agnostic alternative — see `.env.example` for the knobs.
Send a test from `/admin/emails` after cutover.

### 4. Cron — the jobs don't run themselves

Nothing fires `contract-expiry-check`, `certification-expiry-check`,
`vehicle-maintenance-check`, `bid-due-check`, `google-tasks-sync`, or
the cleanup/purge jobs until something POSTs the cron endpoint.
Simplest on a single EC2 box — host crontab:

```
*/5 * * * *  curl -s -X POST -H "x-cron-secret: $CRON_SECRET" "https://opshub.example.com/api/jobs/run?job=google-tasks-sync"
0 * * * *    curl -s -X POST -H "x-cron-secret: $CRON_SECRET" "https://opshub.example.com/api/jobs/run"
```

AWS-native alternative: two EventBridge Scheduler rules targeting the
same URLs (API destination with the `x-cron-secret` header). The
hourly all-jobs run is idempotent — daily jobs self-gate.

### 5. Backups — before anything else

- **RDS**: turn on automated backups (7–35 day retention) and take a
  manual snapshot before each deploy that includes a migration.
- **Self-managed Postgres**: nightly
  `pg_dump -Fc "$DATABASE_URL" > opshub-$(date +%F).dump` shipped to
  S3 (lifecycle-expire after 30 days), plus the same pre-migration
  snapshot habit.
- **Test one restore** into a scratch database before trusting the
  pipeline: `pg_restore --clean --if-exists -d "$SCRATCH_URL" <dump>`.
- The S3 uploads bucket wants versioning ON — that's the file-side
  recovery story.

### 6. Instance sizing + health

The app is a single Node process (standalone Next build). 2 vCPU /
2 GB is comfortable; Postgres separate (RDS t4g.micro is fine to
start). Point the load balancer / uptime monitor at `/api/health`
(200/503, does a `SELECT 1`) — the container HEALTHCHECK already
probes it. Set `TZ=UTC` (calendar-date rendering is UTC-pinned, but
keeping the host on UTC removes a whole class of confusion in logs).

## Admin runbook

### "A workflow is stuck"

1. `/admin/workflows/instances` — find the instance by subject name.
2. Look at the timeline; the topmost `IN_PROGRESS` step is the blocker.
3. If it's a `REQUEST_DOCUMENT` / `REQUEST_SIGNATURE` / `REQUEST_FORM` / `ASSIGN_TASK_TO_SUBJECT` type — that's normal. The subject hasn't completed it yet. Resend the portal link.
4. If it's a `SEND_EMAIL` / `PROVISION_ACCESS` / `SCHEDULE_MEETING` and it's been `IN_PROGRESS` for more than 15 minutes — the watchdog should have reverted it on the next tick. Check `/admin/jobs` for the most recent `workflows-tick` run; if the run says `failed`, the error is in the `lastRun.error` field of `GET /api/admin/health/internals`.
5. If the instance's status is `PAUSED` — a required step failed. The timeline shows the failure reason. Fix the underlying issue (template typo, missing config), then click "Resume" on the instance.

### "Where do I see email failures?"

1. `/admin/emails` — sorted by sentAt desc, last 100 entries.
2. Filter by `status=failed`.
3. The `error` column is capped at 500 chars; full SES/SMTP error text is in container logs (search by `[email.audit]` scope).
4. `GET /api/admin/health/internals` returns `emailFailures24h`; if that's non-zero and rising, look at the active driver name + run a test send from the email-log page.

### "How do I rotate a portal token?"

1. Identify the user with the leaked token. The token lives in `PortalToken` keyed by `(subjectType, subjectId)`.
2. Easiest: deactivate the user (`/admin/users` → toggle `isActive`). New tokens won't be issued; the existing one stops working when the next `getPortalSubject` call rejects an inactive non-offboarding user.
3. If you need to keep the user active but invalidate the link: the only programmatic path right now is `await db.portalToken.delete({ where: { id } })` from a one-off script. The next workflow instance fired for that subject will mint a fresh token. (A self-service "rotate token" admin button is on the followup list — see `docs/raw-research/`.)

### "A scheduled job stopped running"

1. `GET /api/admin/health/internals` — find the job. `lastSuccess` shows the last green run; `lastRun.status` shows where you are now.
2. If `lastRun.status === "running"` and `lastRun.startedAt` is more than an hour old — abandoned worker. The next `runJob` call will reap it automatically (`[jobs.runner] Reaped abandoned running rows`). Force a manual run from `/admin/jobs` or wait for the next cron tick.
3. If `lastRun.status === "failed"` repeatedly with the same error — a code bug or an env regression. The `error` field is truncated; full stack is in container logs at `[jobs.runner] Job handler threw`.
4. If `lastRun` is null — the cron isn't firing. Check the cron provider config and verify `CRON_SECRET` matches.

### "A user wants their data deleted (GDPR)"

OpsHub's hard `db.user.delete()` will fail with `P2003` on any user who has authored Comments, ActivityLog entries, SandboxPages, or CustomWidgets — that's by design (audit history is supposed to survive a single user). The supported flow:

1. Deactivate (`/admin/users` → toggle `isActive` off, set `hasLoginAccess: false`). User can no longer sign in.
2. If true erasure is required by regulation, run a one-off script that nullifies `name` / `email` / `phone` / `avatar` on the User row (anonymization) and explicitly deletes `Account` rows tied to OAuth identities. The audit history references survive but no longer point at PII.

A built-in admin "anonymize user" action is on the followup list.

### "Importer crashed on row N"

`/admin/import` shows the most recent ImportLog row. The `errors` JSON column has per-row outcomes. Common causes:

- Required column not mapped — caught at preview time.
- FK constraint failure (e.g. project assigned to a non-existent client) — surfaces as a `P2003` in the importer's commit catch (`[import.commit] Importer threw`).
- Duplicate unique key (e.g. two rows with the same `quoteNumber`) — surfaces as `P2002`.

Re-run with the offending row removed or fixed.

## Final smoke checklist

Before promoting a build to production:

```bash
# Static checks
npx tsc --noEmit
npx next lint

# Tests
npx vitest run

# Production build
npm run build

# Env validator (with the prod env loaded)
node scripts/validate-env.mjs

# Prisma client regen + migration check
npx prisma generate
npx prisma migrate status
```

Then, against the running container:

```bash
curl -fsS https://opshub.example.com/api/health
curl -fsS "https://opshub.example.com/api/health?check=services"
# Authenticated curl with an admin session cookie:
curl -fsS https://opshub.example.com/api/admin/health/internals | jq '.jobs[] | {key, lastSuccess: .lastSuccess.startedAt}'
```

Verify on the admin Jobs page that every job has a recent successful run, and on the admin Emails page that test sends actually arrive at the configured recipient.

## Production-readiness changelog (phases 1–15)

| Phase | What landed |
| --- | --- |
| 1 — Boot safety | Env validator, P3009 detection, container hardening (curl + tini, HEALTHCHECK), health-endpoint sanitization, email-driver `log`-in-prod refusal, `db:push` disabled in prod. |
| 2 — Auth lockdown | Self-registration disabled; MANAGER privilege escalation closed; certifications admin-gated; read-action gates added across config tables; task scope check; mention search hardened; access-request input validation; project-member role validation. |
| 3 — Portal & token hardening | `loadPortalStep` rejects terminal-state steps + sealed instances; `buildPortalView` drops COMPLETED instances; `getPortalSubject` allows inactive employees only when an OFFBOARDING instance is open; `PortalToken.expiresAt` defaults to 90 days. |
| 4 — Server-action consistency | All throwing admin gates returned as `{error}`; internal `err.message` leaks scrubbed in reports / custom-reports / workflow-instances / import; silent `success: false` returns made explicit. |
| 5 — Workflow & quote correctness | AFTER_STEP cycle detection at template save; ENTITY_CREATE trigger dedup; quote line-item cap at 500. |
| 6 — Custom reports + filter coercion | Field allowlist, operator allowlist, per-type value coercion (number / date / boolean / enum), sortBy validated against column registry. |
| 7 — XSS hardening | `substituteVariables` HTML mode escapes user-text in workflow email bodies. |
| 8 — Job runtime + email reliability | Stuck synchronous workflow step revival in `tick()`; abandoned `JobLog` row reaping; EmailLog error truncation. |
| 9 — Retention | `cleanup-old-job-logs`, `cleanup-old-email-logs` (with body scrub), `cleanup-old-workflow-events` jobs. |
| 10 — Schema improvements | `deleteUser` P2003 catch + friendly error; `WorkflowInstanceStep [status, startedAt]` index for the watchdog. |
| 11 — React 19 codemod | `no-restricted-imports` ESLint rule blocks `useActionState` / `useOptimistic` from `"react"` (would crash at runtime on React 18.3). |
| 12 — Observability | `src/lib/log.ts` structured logger (JSON in prod, pretty in dev); 20+ boundary console sites migrated; `/api/admin/health/internals` endpoint. |
| 13 — Rate limiting | `src/lib/rate-limit.ts` token-bucket; per-IP + per-token gates on portal upload, portal write actions, login, verbose health. |
| 14 — Performance + storage | Per-user storage quota in `uploadFile` with `StorageQuotaExceededError`; `Promise.all` parallelism on the post-tick `maybeCompleteInstance` loop. |
| 15 — Node 20 base | `Dockerfile FROM node:20-slim`; `engines.node: ">=20.0.0"`. |
