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

# Create a minimal prisma CLI bundle for runtime db push
RUN mkdir -p /prisma-cli && \
    cp -r node_modules/prisma /prisma-cli/prisma && \
    cp -r node_modules/@prisma /prisma-cli/@prisma && \
    cp -r node_modules/.prisma /prisma-cli/.prisma && \
    cp -r node_modules/effect /prisma-cli/effect 2>/dev/null || true && \
    cp -r node_modules/c12 /prisma-cli/c12 2>/dev/null || true && \
    cp -r node_modules/deepmerge-ts /prisma-cli/deepmerge-ts 2>/dev/null || true && \
    cp -r node_modules/empathic /prisma-cli/empathic 2>/dev/null || true && \
    cp -r node_modules/confbox /prisma-cli/confbox 2>/dev/null || true && \
    cp -r node_modules/defu /prisma-cli/defu 2>/dev/null || true && \
    cp -r node_modules/exsolve /prisma-cli/exsolve 2>/dev/null || true && \
    cp -r node_modules/ohash /prisma-cli/ohash 2>/dev/null || true && \
    cp -r node_modules/pathe /prisma-cli/pathe 2>/dev/null || true && \
    cp -r node_modules/dotenv /prisma-cli/dotenv 2>/dev/null || true && \
    cp -r node_modules/chokidar /prisma-cli/chokidar 2>/dev/null || true && \
    cp -r node_modules/giget /prisma-cli/giget 2>/dev/null || true && \
    cp -r node_modules/jiti /prisma-cli/jiti 2>/dev/null || true && \
    cp -r node_modules/perfect-debounce /prisma-cli/perfect-debounce 2>/dev/null || true

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

# Copy Prisma schema and seed
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma/client ./node_modules/@prisma/client

# Copy prisma CLI bundle for runtime db push
COPY --from=builder /prisma-cli /app/prisma-cli

# Copy seed dependencies
COPY --from=builder /app/node_modules/bcryptjs ./node_modules/bcryptjs

# Make prisma CLI accessible via the bundle
RUN mkdir -p /app/node_modules/.bin && \
    ln -s /app/prisma-cli/prisma/build/index.js /app/node_modules/.bin/prisma && \
    chmod +x /app/node_modules/.bin/prisma
ENV PATH="/app/node_modules/.bin:$PATH"
ENV NODE_PATH="/app/prisma-cli"

# Copy startup script
COPY --from=builder /app/start.sh ./start.sh

USER nextjs
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["sh", "start.sh"]
