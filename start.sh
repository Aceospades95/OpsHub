#!/bin/sh
echo "Applying database schema..."
npx prisma db push --skip-generate --accept-data-loss 2>&1 || {
  echo "Retrying in 3 seconds..."
  sleep 3
  npx prisma db push --skip-generate --accept-data-loss 2>&1 || echo "Warning: schema migration failed"
}
echo "Starting Next.js server..."
exec node server.js
