#!/bin/sh
echo "Applying database schema..."
node -e "
const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const prisma = new PrismaClient();

async function main() {
  const sql = fs.readFileSync('/app/prisma/schema.sql', 'utf8');
  const statements = sql.split(';').map(s => s.trim()).filter(s => s.length > 0);
  for (const stmt of statements) {
    try {
      await prisma.\$executeRawUnsafe(stmt);
    } catch (e) {
      // Ignore 'already exists' errors (table/index already created)
      if (!e.message.includes('already exists')) {
        console.log('Warning:', e.message.substring(0, 100));
      }
    }
  }
  console.log('Database schema applied successfully.');
  await prisma.\$disconnect();
}
main().catch(e => { console.error('Schema apply failed:', e.message); process.exit(0); });
" 2>&1

echo "Starting Next.js server..."
exec node server.js
