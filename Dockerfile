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
RUN npm ci

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

# Copy Prisma files and FULL node_modules for CLI. Both need
# nextjs:nodejs ownership so prisma can write the .prisma cache and
# query-engine binaries on first boot when the container runs as the
# unprivileged user.
COPY --from=builder --chown=nextjs:nodejs /app/prisma ./prisma
COPY --from=deps --chown=nextjs:nodejs /app/node_modules ./node_modules

# Copy startup script + boot-time env validator. Validator is plain
# JS so it works even before any TypeScript module loads.
COPY --from=builder --chown=nextjs:nodejs /app/start.sh ./start.sh
COPY --from=builder --chown=nextjs:nodejs /app/scripts ./scripts

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
