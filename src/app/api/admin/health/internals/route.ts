/**
 * Admin internals endpoint: GET /api/admin/health/internals
 *
 * Surfaces the operational state an on-call admin needs for fast
 * triage in prod: per-job last run + last error, driver presence,
 * env-config sanity, recent EmailLog failure count.
 *
 * Distinct from /api/health (orchestrator liveness) — this is a richer
 * dashboard payload, gated to ADMIN. The /admin/jobs UI can call it
 * for a single-shot status panel; an on-call engineer can curl it for
 * a quick "what's broken" snapshot when the UI itself is degraded.
 *
 * Returns 200 with a JSON dump even when checks are red — the caller
 * filters/colors the response, the endpoint just reports state.
 *
 * Auth: requires ADMIN. Returns 401 (unauthenticated) or 403 (not
 * admin). No leak of internals to non-admins.
 */

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import { listJobs } from "@/lib/jobs/registry";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  }
  if (session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  const [dbState, jobState, emailFailures] = await Promise.all([
    checkDatabase(),
    collectJobState(),
    countRecentEmailFailures(),
  ]);

  return NextResponse.json({
    ts: new Date().toISOString(),
    nodeEnv: process.env.NODE_ENV ?? "unknown",
    db: dbState,
    drivers: {
      email: process.env.EMAIL_DRIVER || "log",
      storage: process.env.STORAGE_DRIVER || "local",
    },
    cronConfigured: !!process.env.CRON_SECRET,
    emailFailures24h: emailFailures,
    jobs: jobState,
  });
}

async function checkDatabase(): Promise<{ ok: boolean }> {
  try {
    await db.$queryRaw`SELECT 1`;
    return { ok: true };
  } catch {
    // The /api/health endpoint already logs the underlying error
    // server-side. We don't need to log it twice from this richer
    // diagnostic endpoint.
    return { ok: false };
  }
}

interface JobState {
  key: string;
  name: string;
  enabled: boolean;
  lastRun: {
    startedAt: string;
    finishedAt: string | null;
    status: string;
    durationMs: number | null;
    processed: number | null;
    /** Truncated so a 200KB stack doesn't bloat the response. */
    error: string | null;
  } | null;
  /** Last successful run (status === "completed"), even if a more
   *  recent run failed. Lets the dashboard show "last green at" plus
   *  "currently failing since". */
  lastSuccess: { startedAt: string } | null;
}

async function collectJobState(): Promise<JobState[]> {
  const jobs = listJobs();

  // One round-trip per job is fine — there are <20 — and keeps the
  // query simple. A grouped query would still need to dispatch a
  // separate "find last success" step per job.
  const out: JobState[] = [];
  for (const job of jobs) {
    const [config, last, lastSuccess] = await Promise.all([
      db.jobConfig.findUnique({ where: { jobKey: job.key } }),
      db.jobLog.findFirst({
        where: { jobKey: job.key },
        orderBy: { startedAt: "desc" },
      }),
      db.jobLog.findFirst({
        where: { jobKey: job.key, status: "completed" },
        orderBy: { startedAt: "desc" },
        select: { startedAt: true },
      }),
    ]);

    out.push({
      key: job.key,
      name: job.name,
      enabled: config ? config.isEnabled : true,
      lastRun: last
        ? {
            startedAt: last.startedAt.toISOString(),
            finishedAt: last.finishedAt?.toISOString() ?? null,
            status: last.status,
            durationMs: last.durationMs,
            processed: last.processed,
            error: last.error ? truncate(last.error, 500) : null,
          }
        : null,
      lastSuccess: lastSuccess
        ? { startedAt: lastSuccess.startedAt.toISOString() }
        : null,
    });
  }
  return out;
}

async function countRecentEmailFailures(): Promise<number> {
  try {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    return await db.emailLog.count({
      where: { status: "failed", sentAt: { gte: since } },
    });
  } catch {
    return -1;
  }
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max - 1) + "…";
}
