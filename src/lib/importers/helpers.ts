/**
 * Shared commit-time helpers for importers.
 *
 * Every importer routes its create/update/skip decision through
 * `applyMode()` and (for fill-blanks updates) `mergeFillBlanks()` so
 * the four import modes behave identically across the registry, and
 * its per-run totals through `buildResult()` so warning counting can't
 * drift from the per-row outcomes.
 *
 * Activity logging inside commit() goes through `logImportActivity()`
 * — a ctx.db-bound clone of src/lib/activity's logActivity — so
 * preview runs (which hand importers a rolled-back transaction client)
 * leak no ActivityLog rows.
 */

import type {
  ImportContext,
  ImportMode,
  ImportResult,
  ImportRowResult,
} from "./types";

/** What commit() should do with one row after natural-key matching. */
export type ModeAction = "create" | "update" | "skip";

/**
 * Resolve the action for a row given whether an existing record matched
 * the importer's natural key. `existing` is truthiness-checked so
 * callers can pass the matched id, the matched record, or null.
 *
 *   mode         match found      no match
 *   create       skip             create
 *   update       update           skip
 *   upsert       update           create
 *   fill-blanks  update (merged   create
 *                via mergeFillBlanks)
 */
export function applyMode(
  existing: unknown,
  mode: ImportMode | undefined
): ModeAction {
  const m: ImportMode = mode ?? "create";
  if (existing) {
    return m === "create" ? "skip" : "update";
  }
  return m === "update" ? "skip" : "create";
}

/**
 * Skip message for create-mode rows that matched an existing record.
 * Keep the "already exists" phrasing — the wizard + tests key off it.
 */
export function skipExistsMessage(label: string): string {
  return `${label} already exists — skipped in "Create new only" mode. Re-run in "Create + update" mode to update it.`;
}

/**
 * Skip message for update-mode rows that matched nothing. Keep the
 * "no existing record" phrasing — the wizard + tests key off it.
 */
export function skipNoMatchMessage(label: string): string {
  return `${label} matched no existing record — skipped in "Update existing only" mode. Re-run in "Create + update" mode to create it.`;
}

/**
 * "Empty" for fill-blanks purposes: null/undefined, whitespace-only
 * strings, and empty arrays. Numbers (including 0), booleans, and
 * Dates always count as data — a stored `false` or `0` is a real
 * value that fill-blanks must never overwrite.
 */
export function isBlank(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === "string") return value.trim() === "";
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

/**
 * Build the update payload for a fill-blanks update: keep only the
 * incoming fields that are non-empty AND currently empty on the
 * existing record. Never overwrites non-empty data. May return an
 * empty object when there's nothing to fill — callers can skip the
 * write in that case (still reported as "updated").
 *
 * `existing` is the full current record (fetched fresh by the caller);
 * a null/undefined record defensively falls back to writing everything
 * (equivalent to a plain upsert update).
 */
export function mergeFillBlanks<T extends Record<string, unknown>>(
  existing: Record<string, unknown> | null | undefined,
  incoming: T
): Partial<T> {
  if (!existing) return { ...incoming };
  const out: Partial<T> = {};
  for (const key of Object.keys(incoming) as (keyof T & string)[]) {
    const next = incoming[key];
    if (isBlank(next)) continue;
    if (!isBlank(existing[key])) continue;
    out[key] = next;
  }
  return out;
}

/** `warnings.length ? warnings : undefined` — keeps clean rows clean. */
export function warnList(warnings: string[]): string[] | undefined {
  return warnings.length > 0 ? warnings : undefined;
}

/**
 * Attach a warning to an already-recorded row result. Used by
 * second-pass FK resolution (manager links, account managers) where
 * the row outcome was pushed before the link was attempted.
 */
export function addWarning(
  result: ImportRowResult | undefined,
  warning: string
): void {
  if (!result) return;
  if (!result.warnings) result.warnings = [];
  result.warnings.push(warning);
}

/**
 * Derive the aggregate counts from the per-row outcomes. Single source
 * of truth: importers return `buildResult(results)` instead of hand
 * tallying counters that can drift from the rows array. `warnings`
 * counts rows that were written (imported/updated) with at least one
 * warning — failed/skipped rows never contribute.
 */
export function buildResult(rows: ImportRowResult[]): ImportResult {
  let imported = 0;
  let updated = 0;
  let skipped = 0;
  let failed = 0;
  let warnings = 0;
  for (const r of rows) {
    if (r.status === "imported") imported++;
    else if (r.status === "updated") updated++;
    else if (r.status === "skipped") skipped++;
    else failed++;
    if (
      (r.status === "imported" || r.status === "updated") &&
      r.warnings &&
      r.warnings.length > 0
    ) {
      warnings++;
    }
  }
  return { imported, updated, skipped, failed, warnings, rows };
}

/**
 * Activity-log write bound to the import context. Same row shape as
 * src/lib/activity's logActivity, but through ctx.db so preview runs
 * roll the row back with everything else, and attributed to
 * ctx.triggeredBy automatically.
 */
export async function logImportActivity(
  ctx: ImportContext,
  action: string,
  entityType: string,
  entityId: string,
  details?: string,
  options?: { projectId?: string | null; clientId?: string | null }
): Promise<void> {
  await ctx.db.activityLog.create({
    data: {
      action,
      entityType,
      entityId,
      userId: ctx.triggeredBy,
      details,
      projectId: options?.projectId ?? null,
      clientId: options?.clientId ?? null,
    },
  });
}
