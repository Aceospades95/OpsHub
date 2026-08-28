---
name: verify
description: Boot a real OpsHub instance (Postgres + seeded admin + log email driver) and drive it with Playwright to verify changes end-to-end.
---

# Verifying OpsHub end-to-end in a sandbox

Recipe proven 2026-07-17 (reports/customization sweep). Total cold-start ≈ 5 min.

## 1. Local Postgres (no docker daemon needed)

Postgres 16 server binaries live at `/usr/lib/postgresql/16/bin`. `initdb`
refuses root — run the cluster as the `postgres` system user, and keep the
data dir under `/var/lib/postgresql` (scratchpad paths deny traversal to
that user):

```bash
PGDIR=/var/lib/postgresql/opshub-pg
su postgres -s /bin/bash -c "mkdir -p $PGDIR/sock && /usr/lib/postgresql/16/bin/initdb -D $PGDIR/data -U opshub --auth=trust -E UTF8"
su postgres -s /bin/bash -c "/usr/lib/postgresql/16/bin/pg_ctl -D $PGDIR/data -o '-p 5455 -k $PGDIR/sock -c listen_addresses=127.0.0.1' -l $PGDIR/pg.log start"
psql -h 127.0.0.1 -p 5455 -U opshub -d postgres -c "CREATE DATABASE opshub;"
DATABASE_URL="postgresql://opshub@127.0.0.1:5455/opshub" npx prisma migrate deploy
```

## 2. Seed an admin (login is credentials-based)

The password column is `hashedPassword` (bcryptjs). Node scripts outside the
repo can't resolve deps — symlink `node_modules` next to the script. Minimal
seed: User (role ADMIN, isActive, hasLoginAccess) + a Client + Contracts
with `status: "ACTIVE"` and `endDate` inside 60 days (the expiring report
filters `status IN (ACTIVE, EXPIRING_SOON, UNDER_REVIEW)` — DRAFT rows are
invisible to it).

## 3. Run the built app

```bash
DATABASE_URL=... NEXTAUTH_URL="http://localhost:3100" \
NEXTAUTH_SECRET="<32+ chars>" \
EMAIL_DRIVER=log ALLOW_LOG_DRIVER_IN_PROD=true \
EMAIL_FROM="noreply@example.com" CRON_SECRET="<anything>" \
STORAGE_DRIVER=local npx next start -p 3100
```

Gotchas:
- `EMAIL_DRIVER=log` alone is REJECTED at send time in production builds —
  `ALLOW_LOG_DRIVER_IN_PROD=true` is mandatory. Sends then land as
  `EmailLog` rows (`toAddresses`/`bodyHtml`/`sentAt` columns) — that table
  is your email evidence.
- Killing the server: `pkill -f "next start"` only kills the CLI wrapper;
  the listener is a separate `next-server` process — `pkill -f next-server`
  or the port stays bound (EADDRINUSE on restart).
- The standalone-output warning from `next start` is harmless here.
- Jobs fire for real via `curl -X POST -H "x-cron-secret: $CRON_SECRET"
  "http://localhost:3100/api/jobs/run?job=<jobKey>"`.

## 4. Drive with Playwright

Chromium binary: `/opt/pw-browsers/chromium-1194/chrome-linux/chrome`
(pass as `executablePath`; do NOT `playwright install`). Install the
`playwright` npm package in a scratch dir, not the repo.

- Login form: `input[name=email]`, `input[name=password]`, submit → lands
  on `/my`.
- Curl needs `--noproxy localhost,127.0.0.1` or the agent proxy eats it.
- Dialog components don't close on Escape — click their Cancel button.
- Dropdown row menus ("More actions") overlay a backdrop; scope text
  clicks (`.last()`, `getByRole`) or the click hits page copy behind it.
- The custom-report builder's Save redirects to the EDIT page, not the
  view page.
- `waitForLoadState("networkidle")` returns while RSC pages still show
  their loading.tsx skeleton, and admin report pages fetch results
  client-side after mount — reading `body` text then yields false
  negatives. Wait for a CONCRETE element (`h1` with the record name, a
  data row) before asserting page text; when a check fails, look at the
  screenshot before assuming an app bug.
- The styled `useConfirm` dialog is `div[role=alertdialog]` — click its
  confirm button inside that scope (`.last()` picks the destructive one).
- Seeding: enum values must match schema exactly (`CertificationType`
  has no DIVERSITY/REGISTRATION — use COMPLIANCE/VENDOR); start the
  seed with dependency-ordered `deleteMany` calls so re-runs are clean.

## 5. Flows worth re-driving after report/notification changes

customize→save→preview/list/CSV/email · scheduled task create/run (picker
names) · hide→picker/digest/scheduled-skip → un-hide/reset · digest job via
cron endpoint · clone-to-custom (`?entity=` preselect). Check `EmailLog`
after each send; `ReportOverride` should have 0 rows after a full reset.
