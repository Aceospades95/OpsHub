FROM node:20-slim AS base
# Pinned to Node 20 LTS. Node 18 hit maintenance EOL April 2025; the
# AWS SDK v3, NextAuth, and Prisma all drop 18 support in their next
# majors, and Node 20 exposes globalThis.File / Blob without the
# node:buffer import dance the legacy upload helpers had to work
# around. Stay on -slim (Debian) rather than -alpine because Prisma's
# query engine needs glibc.
#
# openssl: prisma's query engine needs it.
# curl: HEALTHCHECK probes /api/health.
# tini: optional but small init that reaps zombies; keeps SIGTERM behavior
# clean when the orchestrator stops the container.
RUN apt-get update -y \
  && apt-get install -y --no-install-recommends openssl curl tini \
  && rm -rf /var/lib/apt/lists/*

# Install dependencies
FROM base AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
# esbuild's postinstall execs its just-written binary; with npm's
# parallel script workers that intermittently fails with ETXTBSY
# (text file busy) on overlayfs — the flake that broke publish run
# #298. --foreground-scripts serializes the lifecycle scripts (closing
# the open-fd race) and the `||` retry absorbs anything left; builds
# run with no-cache, so every publish re-rolls this dice.
RUN npm ci --foreground-scripts || npm ci --foreground-scripts

# Generate Prisma client
COPY prisma ./prisma
RUN npx prisma generate

# Build the application
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Create public dir if it doesn't exist
RUN mkdir -p public

ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# Production image - use full node_modules for prisma CLI support
FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

# Copy built app
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# Prisma files: ONLY schema.prisma + migrations/. The seed / cleanup /
# merge / backfill / dedupe / migrate-slug / promote-admin scripts
# stay in the build stage and are never shipped to runtime — they're
# operator one-offs, not boot-path code, and including them inflates
# the image and creates a dev-tool-shaped surface in production.
# `prisma migrate deploy` only needs the schema and migrations.
COPY --from=builder --chown=nextjs:nodejs /app/prisma/schema.prisma ./prisma/schema.prisma
COPY --from=builder --chown=nextjs:nodejs /app/prisma/migrations ./prisma/migrations

# Full node_modules from the deps stage (Prisma CLI needs to be
# resolvable at boot for `npx prisma migrate deploy`). Owned by
# nextjs:nodejs so the unprivileged runtime user can write the
# .prisma cache and query-engine binaries on first boot.
COPY --from=deps --chown=nextjs:nodejs /app/node_modules ./node_modules

# Startup script + boot-time env validator. Validator is plain JS
# (no TS transpile required) so it can run before the app server.
# Only validate-env.mjs ships — check-no-pii.sh and any future
# dev/CI-only scripts are explicitly excluded.
COPY --from=builder --chown=nextjs:nodejs /app/start.sh ./start.sh
COPY --from=builder --chown=nextjs:nodejs /app/scripts/validate-env.mjs ./scripts/validate-env.mjs

# Pre-create the local-storage directory and hand it to nextjs:nodejs.
# Without this the first upload fails with `EACCES: permission denied,
# mkdir '/app/.storage'` because /app itself is owned by root from the
# WORKDIR step — the container user can write into chowned subdirs but
# can't create a new top-level child of /app. Set STORAGE_LOCAL_DIR to
# point at a host bind-mount in production single-node deploys (Unraid,
# self-hosted) so the bytes survive container restarts.
RUN mkdir -p /app/.storage/files && chown -R nextjs:nodejs /app/.storage

USER nextjs
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

# Liveness probe — orchestrators (ECS, Kubernetes, plain Docker) use
# this to detect a wedged container. /api/health does a SELECT 1 and
# returns 200 / 503. Generous start-period because prisma migrate
# deploy on a fresh DB can take a moment.
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD curl --silent --fail --max-time 4 http://localhost:3000/api/health || exit 1

# tini handles SIGTERM/SIGCHLD cleanly so docker stop / ECS task drain
# don't end up sending SIGKILL after timeout.
ENTRYPOINT ["tini", "--"]
CMD ["sh", "start.sh"]
