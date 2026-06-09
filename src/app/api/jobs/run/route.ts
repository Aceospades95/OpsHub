/**
 * Scheduled job runner endpoint.
 *
 * POST /api/jobs/run
 *   Authenticated by a shared secret in the `x-cron-secret` header (or
 *   the `Authorization: Bearer <secret>` header). Set `CRON_SECRET` in
 *   env to enable. The endpoint is intentionally simple so any external
 *   cron provider (Vercel Cron, GitHub Actions schedule, OS cron + curl)
 *   can drive it.
 *
 * Query params:
 *   ?job=KEY    Run a single job by registry key
 *   (none)      Run every registered job sequentially
 *
 * Returns JSON with the result(s):
 *   { status: "completed" | "failed" | "skipped" | "unknown", ... }
 *   or
 *   { results: { jobKey: result, ... } }
 *
 * Failure mode: an authentication failure returns 401 immediately. A job
 * runtime failure returns 200 with the failure recorded in the response
 * body and in JobLog — the cron caller doesn't need to know how to
 * interpret HTTP statuses for individual job failures.
 */

import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { runJob, runAllJobs } from "@/lib/jobs";

// Constant-time secret comparison. Hash both sides first so the buffers
// always have equal length — timingSafeEqual throws on a length mismatch,
// and bailing early on length would itself leak timing information.
function secretsMatch(provided: string, expected: string): boolean {
  const a = createHash("sha256").update(provided).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

function isAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  // If no secret is configured, refuse — better than running anonymously
  // in production by accident
  if (!secret) return false;

  const headerSecret = request.headers.get("x-cron-secret");
  if (headerSecret && secretsMatch(headerSecret, secret)) return true;

  const authHeader = request.headers.get("authorization");
  if (authHeader && secretsMatch(authHeader, `Bearer ${secret}`)) return true;

  return false;
}

export async function POST(request: Request) {
  if (!isAuthorized(request)) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const url = new URL(request.url);
  const jobKey = url.searchParams.get("job");

  if (jobKey) {
    const result = await runJob(jobKey, "cron");
    return NextResponse.json({ jobKey, ...result });
  }

  const results = await runAllJobs("cron");
  return NextResponse.json({ results });
}

// Jobs are state-changing, so they must be triggered via POST. A GET
// (browser bookmark, link prefetcher, crawler) must never run jobs.
export async function GET() {
  return new NextResponse("Method Not Allowed — trigger jobs via POST", {
    status: 405,
    headers: { Allow: "POST" },
  });
}
