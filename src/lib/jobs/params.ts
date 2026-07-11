/**
 * Typed per-job parameters, stored in JobConfig.params (JSON) and
 * edited at /admin/jobs/[jobKey] via the form generated from the job's
 * paramsSchema. Handlers never read JobConfig directly — they call
 * getJobParams with their code defaults, and stored values win only
 * when they exist AND match the default's primitive type, so a stale
 * or hand-mangled row can't crash a job.
 */

import { db } from "@/lib/db";

export async function getJobParams<
  T extends Record<string, number | boolean | string>,
>(jobKey: string, defaults: T): Promise<T> {
  try {
    const row = await db.jobConfig.findUnique({
      where: { jobKey },
      select: { params: true },
    });
    const stored = row?.params;
    if (!stored || typeof stored !== "object" || Array.isArray(stored)) {
      return { ...defaults };
    }
    const merged: Record<string, number | boolean | string> = { ...defaults };
    for (const [key, fallback] of Object.entries(defaults)) {
      const value = (stored as Record<string, unknown>)[key];
      if (typeof value === typeof fallback) {
        // NaN can sneak in via JSON round-trips of bad form input.
        if (typeof value === "number" && !Number.isFinite(value)) continue;
        merged[key] = value as number | boolean | string;
      }
    }
    return merged as T;
  } catch {
    // Params are tuning, never availability — fall back to defaults.
    return { ...defaults };
  }
}
