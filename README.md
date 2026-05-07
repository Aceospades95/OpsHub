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

- No User rows carrying the OpsHub team's own emails (e.g.
  `*@wynndalco.com`, `jakewright95@gmail.com`).
- No `EmailLog` rows referencing those addresses.
- No `AllowedDomain` rows for the OpsHub team's company domain.
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

`npm run ci` (lint + test + build) mirrors the prod Docker build's
quality gate. Run before pushing — CI is set up to fail on the same
things `next build` fails on, so green here means green there.

## Test data

Test data is created **through the UI**, not via seeds. The
`prisma/seed-realistic.ts` script exists for local reference but is
not wired into any boot path or `npm run` shortcut that runs as part
of a deploy. It uses RFC 2606 reserved domains (`*.example.com`)
exclusively — no real customer / operator strings.
