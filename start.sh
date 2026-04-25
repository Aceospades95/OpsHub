#!/bin/sh
set -e

echo "Applying database migrations..."
attempt=1
max_attempts=4
delay=2
while true; do
  if npx prisma migrate deploy; then
    break
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
