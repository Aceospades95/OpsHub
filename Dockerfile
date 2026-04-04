FROM node:18-alpine AS base

# Install dependencies
FROM base AS deps
WORKDIR /app
COPY package.json package-lock.json ./
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
RUN npm run build; BUILD_EXIT=$?; \
    if [ $BUILD_EXIT -ne 0 ]; then \
      echo "========== BUILD FAILED (exit $BUILD_EXIT) =========="; \
      echo "Node version:"; node --version; \
      echo "npm version:"; npm --version; \
      echo "=== .next/trace (last 50 lines) ==="; \
      tail -50 .next/trace 2>/dev/null || echo "no trace file"; \
      exit $BUILD_EXIT; \
    fi

# Bundle seed.ts into a single JS file using esbuild (already a Next.js dep)
RUN npx esbuild prisma/seed.ts --bundle --platform=node --outfile=prisma/seed.js \
    --external:@prisma/client --external:bcryptjs 2>/dev/null || true

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

# Copy Prisma files and FULL node_modules for CLI
COPY --from=builder /app/prisma ./prisma
COPY --from=deps /app/node_modules ./node_modules

# Copy startup script
COPY --from=builder /app/start.sh ./start.sh

USER nextjs
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["sh", "start.sh"]
