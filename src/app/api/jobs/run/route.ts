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

import { NextResponse } from "next/server";
import { runJob, runAllJobs } from "@/lib/jobs";

function isAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  // If no secret is configured, refuse — better than running anonymously
  // in production by accident
  if (!secret) return false;

  const headerSecret = request.headers.get("x-cron-secret");
  if (headerSecret && headerSecret === secret) return true;

  const authHeader = request.headers.get("authorization");
  if (authHeader && authHeader === `Bearer ${secret}`) return true;

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

// Allow GET for health checks / human visits — same auth, same behavior.
// Useful when an admin wants to test the endpoint with a browser bookmark.
export async function GET(request: Request) {
  return POST(request);
}
