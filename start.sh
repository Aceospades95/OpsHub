#!/bin/sh
echo "Applying database schema..."
NODE_PATH=/app/prisma-cli npx prisma db push --skip-generate --accept-data-loss 2>&1 || echo "Warning: prisma db push failed - will retry once..."
# Retry once if it failed (DB might not be ready yet)
if [ $? -ne 0 ]; then
  sleep 3
  NODE_PATH=/app/prisma-cli npx prisma db push --skip-generate --accept-data-loss 2>&1 || echo "Warning: schema migration failed"
fi
echo "Starting Next.js server..."
exec node server.js
