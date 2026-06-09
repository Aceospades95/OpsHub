# OpsHub

Internal operations console — projects, clients, contracts, tasks, quotes,
workflows, and adjacent admin tooling.

## Production deploys: start from an empty DB

The Docker image is intentionally **seed-inert**: it does not run any
`seed:*` script during build or container boot. The boot path is
`scripts/validate-env.mjs` → `prisma migrate deploy` → `node server.js`.
No fixtures, no demo data.

Before promoting a new customer to production, the backing database
must be empty (or hand-curated). Specifically, the image expects:

- No User rows carrying internal-team or operator emails left over
  from prior development (e.g. `*@your-company.example`,
  personal Gmail addresses used for testing).
- No `EmailLog` rows referencing those addresses.
- No `AllowedDomain` rows for the operator team's company domain.
- No `ThemeSetting` rows containing the OpsHub team's branding.
- No `Client` / `Project` / etc. rows carrying real customer data
  from a different tenant.

Promotion checklist:

1. From the production-bound deployment, sign in as ADMIN and visit
   **Settings → PII Scan** (`/admin/pii-scan`). It scans User /
   EmailLog / AllowedDomain / ThemeSetting for the configured
   real-data patterns and lists every match with a deep-link to
   the appropriate UI for cleanup.
2. Clean each flagged row through the linked admin UI. The page is
   read-only; it never mutates data on its own.
3. Re-run the scan; it should report "No flagged rows."
4. Confirm `EMAIL_DRIVER` and `EMAIL_FROM` are set to the customer's
   real provider config. Outside of `NODE_ENV=production`, real
   email drivers are forced to `log` by default — see
   `src/lib/email/drivers.ts`. Set `ALLOW_REAL_EMAIL_IN_NONPROD=true`
   only when an integration test rig actually needs to talk to a
   live SMTP / SES endpoint.

## Local development

```sh
npm install
npm run db:generate
npm run db:push          # writes the schema to $DATABASE_URL
npm run dev              # starts Next.js on http://localhost:3000
```

`npm run ci` runs the same gates as the GitHub Actions workflow:
`lint` → `lint:pii` → `test` → `build`. Run before pushing.

## Before you push

The repository enforces these gates in CI (`.github/workflows/ci.yml`)
— anything that fails locally fails there too:

- **`npm run lint`** — ESLint. Includes the no-`.skip()` rule (R11-I)
  so a forgotten `it.skip()` lands as a failed CI build, not a quietly
  un-run test.
- **`npm run lint:pii`** (`scripts/check-no-pii.sh`) — fails if any
  historical operator/customer real-data string sneaks back into the
  tree (R11-A purge baseline).
- **`npm run test`** — Vitest. 5 skipped tests would have been a soft
  fail; they were either deleted or converted to `test.todo` in R11-I.
- **`npm run build`** — Next standalone build. Pre-deploys, the build
  output prints `Middleware = 79 kB`; if that grows past ~110 kB, the
  Edge bundle has regressed (see R11-E).
- **Docker bloat audit** (CI only — needs a Docker daemon) —
  `scripts/check-docker-bloat.sh` against the built image asserts
  `/app/scripts` has only `validate-env.mjs` and `/app/prisma` has no
  loose `*.ts` outside `migrations/`.

After deploying, run `BASE_URL=<deploy-url> npm run smoke` to hit a
handful of RSC routes 50× each and confirm no 5xx. See R11-G for the
context on why this exists.

## Test data

Test data is created **through the UI**, not via seeds. The
`prisma/seed-realistic.ts` script exists for local reference but is
not wired into any boot path or `npm run` shortcut that runs as part
of a deploy. It uses RFC 2606 reserved domains (`*.example.com`)
exclusively — no real customer / operator strings.
