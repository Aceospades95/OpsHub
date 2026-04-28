#!/bin/sh
set -e

# 1. Validate environment variables before doing anything else.
# Fails fast with an actionable error if any required var is missing.
echo "Validating environment..."
node scripts/validate-env.mjs

# 2. Apply database migrations.
# Retries are bounded and ONLY for transient failures (DB connect refused,
# timeout). A P3009 (failed migration row in _prisma_migrations) is
# terminal — retrying just hits the same poisoned row, so we exit
# immediately with a recovery message rather than crashloop forever.
echo "Applying database migrations..."
attempt=1
max_attempts=4
delay=2
while true; do
  # Capture both stdout and stderr so we can grep for known terminal codes.
  output=$(npx prisma migrate deploy 2>&1)
  exit_code=$?
  echo "$output"

  if [ $exit_code -eq 0 ]; then
    break
  fi

  # P3009 = failed migration row. Manual `prisma migrate resolve` required.
  # P3018 = a single migration failed mid-apply. Same recovery story.
  if echo "$output" | grep -qE "P3009|P3018"; then
    cat >&2 <<'EOF'

============================================================
MIGRATION RECOVERY REQUIRED — manual intervention needed
============================================================

A previous migration is marked as failed in _prisma_migrations.
Retrying won't fix it; the row needs to be resolved by hand.

If the schema changes have already been applied (e.g. an earlier
'prisma db push' set up the tables), mark the migration as
applied without re-running it:

  npx prisma migrate resolve --applied <migration-name>

If the migration's partial state needs to be undone first, mark
as rolled-back:

  npx prisma migrate resolve --rolled-back <migration-name>

Then restart this container.
============================================================
EOF
    exit 1
  fi

  if [ "$attempt" -ge "$max_attempts" ]; then
    echo "ERROR: prisma migrate deploy failed after ${attempt} attempts" >&2
    exit 1
  fi
  echo "Migration attempt ${attempt} failed; retrying in ${delay}s..." >&2
  sleep "$delay"
  attempt=$((attempt + 1))
  delay=$((delay * 2))
done

echo "Starting Next.js server..."
exec node server.js
