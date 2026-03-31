#!/bin/sh
echo "Running Prisma db push to ensure tables exist..."
npx prisma db push --skip-generate 2>&1 || echo "Warning: prisma db push failed - database may not be ready yet"
echo "Starting Next.js server..."
exec node server.js
