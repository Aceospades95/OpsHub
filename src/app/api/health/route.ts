/**
 * Health check route: GET /api/health
 *
 * Returns 200 with `{ status: "ok" }` when the app can reach the
 * database, 503 with `{ status: "error", reason }` when it can't.
 *
 * Intended for AWS load balancer / ECS / Fargate target group health
 * checks. Cheap on purpose: a single `SELECT 1` with no auth, no
 * session lookup, no rendering. Returning a 5xx triggers the LB to
 * mark the task unhealthy and (per the configured policy) replace it.
 *
 * Public on purpose: target groups don't authenticate. The response
 * does not leak any sensitive data. We deliberately do not include
 * version / build info here so the endpoint stays useful for liveness
 * probes without becoming a fingerprinting surface.
 */

import { NextResponse } from "next/server";
import { db } from "@/lib/db";

// Always run this fresh on each call — caching a health check defeats
// the point.
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await db.$queryRaw`SELECT 1`;
    return NextResponse.json({ status: "ok" }, { status: 200 });
  } catch (err) {
    return NextResponse.json(
      {
        status: "error",
        reason: err instanceof Error ? err.message : "database unreachable",
      },
      { status: 503 }
    );
  }
}
