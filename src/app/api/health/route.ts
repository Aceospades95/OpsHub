/**
 * Health check route: GET /api/health
 *
 * Default mode (liveness — what orchestrators hit):
 *   200 { status: "ok" } when the app can reach the database.
 *   503 { status: "error", reason: "database unavailable" } otherwise.
 *
 *   Reason is intentionally a static, non-leaky string. The full error
 *   is logged server-side (where ECS / CloudWatch can see it) but never
 *   returned in the body — a failing health check is a popular target
 *   for fingerprinting and we don't want connection-string fragments,
 *   user names, or migration-drift errors to leak through it.
 *
 * Verbose mode: GET /api/health?check=services
 *   Adds checks for the configured email driver and storage driver so
 *   a deploy smoke-test can catch misconfiguration immediately. Returns
 *   the same 200/503 status, plus a `checks` map with per-service
 *   booleans and (on failure) a one-liner that's intentionally generic.
 *
 *   Verbose mode does not require auth — it returns the SAME info
 *   shape an admin could derive by reading config — but to keep the
 *   endpoint cheap for high-frequency liveness probes the verbose
 *   path runs only when explicitly asked.
 */

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { log } from "@/lib/log";

// Always run this fresh on each call — caching a health check defeats
// the point.
export const dynamic = "force-dynamic";

interface ServiceCheck {
  ok: boolean;
  reason?: string;
}

async function checkDatabase(): Promise<ServiceCheck> {
  try {
    await db.$queryRaw`SELECT 1`;
    return { ok: true };
  } catch (err) {
    log.error("health.db", "Database check failed", err);
    return { ok: false, reason: "database unavailable" };
  }
}

function checkEmailDriver(): ServiceCheck {
  const driver = (process.env.EMAIL_DRIVER || "log").toLowerCase();
  const isProduction = process.env.NODE_ENV === "production";
  if (isProduction && driver === "log" && process.env.ALLOW_LOG_DRIVER_IN_PROD !== "true") {
    return { ok: false, reason: "email driver is 'log' in production" };
  }
  if (driver === "ses" && !process.env.SES_REGION) {
    return { ok: false, reason: "SES driver missing SES_REGION" };
  }
  if (driver === "smtp") {
    if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASSWORD) {
      return { ok: false, reason: "SMTP driver missing required env" };
    }
  }
  if (driver !== "log" && !process.env.EMAIL_FROM) {
    return { ok: false, reason: "EMAIL_FROM not set" };
  }
  return { ok: true };
}

function checkStorageDriver(): ServiceCheck {
  const driver = (process.env.STORAGE_DRIVER || "local").toLowerCase();
  if (driver === "s3") {
    if (!process.env.S3_BUCKET || !process.env.S3_REGION) {
      return { ok: false, reason: "S3 driver missing S3_BUCKET or S3_REGION" };
    }
  }
  return { ok: true };
}

function checkCronSecret(): ServiceCheck {
  const isProduction = process.env.NODE_ENV === "production";
  if (isProduction && !process.env.CRON_SECRET) {
    return { ok: false, reason: "CRON_SECRET not set; scheduled jobs will not fire" };
  }
  return { ok: true };
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const verbose = url.searchParams.get("check") === "services";

  const dbCheck = await checkDatabase();

  if (!verbose) {
    if (dbCheck.ok) {
      return NextResponse.json({ status: "ok" }, { status: 200 });
    }
    return NextResponse.json(
      { status: "error", reason: dbCheck.reason ?? "database unavailable" },
      { status: 503 }
    );
  }

  // Verbose: run every check, report a 503 if ANY fail.
  const checks = {
    db: dbCheck,
    email: checkEmailDriver(),
    storage: checkStorageDriver(),
    cron: checkCronSecret(),
  };
  const allOk = Object.values(checks).every((c) => c.ok);
  return NextResponse.json(
    {
      status: allOk ? "ok" : "error",
      checks,
    },
    { status: allOk ? 200 : 503 }
  );
}
