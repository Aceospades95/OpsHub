FROM node:18-alpine AS base

# Install dependencies
FROM base AS deps
WORKDIR /app
COPY package.json ./
RUN npm install

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

RUN npm run build

# Bundle seed.ts into a single JS file using esbuild (already a Next.js dep)
RUN npx esbuild prisma/seed.ts --bundle --platform=node --outfile=prisma/seed.js \
    --external:@prisma/client --external:bcryptjs 2>/dev/null || true

# Production image
FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

# Copy built app
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# Copy Prisma files and full node_modules needed for CLI
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=builder /app/node_modules/prisma ./node_modules/prisma

# Copy seed dependencies
COPY --from=builder /app/node_modules/bcryptjs ./node_modules/bcryptjs

# Make prisma CLI accessible
RUN mkdir -p /app/node_modules/.bin && \
    ln -s /app/node_modules/prisma/build/index.js /app/node_modules/.bin/prisma && \
    chmod +x /app/node_modules/.bin/prisma
ENV PATH="/app/node_modules/.bin:$PATH"

# Copy startup script
COPY --from=builder /app/start.sh ./start.sh

USER nextjs
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["sh", "start.sh"]
