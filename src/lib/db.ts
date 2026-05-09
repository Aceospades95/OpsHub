/**
 * Singleton PrismaClient.
 *
 * Stored on globalThis so a single process never holds more than one
 * client. Two reasons this matters:
 *
 *   - Dev (Next HMR): every hot-reload re-evaluates the module that
 *     defines `db`. Without globalThis caching, each reload leaks a
 *     PrismaClient and its query-engine subprocess until the dev
 *     server runs out of file handles.
 *   - Prod: each Node process should have exactly one query-engine
 *     subprocess. Engine init (~200-400ms in our deploy) is one of
 *     the leading-suspect contributors to the RSC 503 storm
 *     (docs/rsc-503-diagnosis.md). Caching on globalThis is
 *     defensive against any code path that might re-evaluate this
 *     module — workers, instrumentation hooks, future bundler tweaks.
 *
 * The previous implementation only assigned to globalThis in dev.
 * The "modules are cached anyway" argument is true for plain Node,
 * but Next's standalone server uses webpack-style runtime caching
 * which can — under weird hot-reload-of-instrumentation conditions —
 * end up with two copies. Prod-side defense is cheap, so we do it.
 */

import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const db = globalForPrisma.prisma ?? new PrismaClient();

globalForPrisma.prisma = db;
