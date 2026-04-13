/**
 * Shared types for the scheduled jobs infrastructure.
 *
 * Same shape as the email and storage layers: definitions live in a registry,
 * a single runJob() entry point handles execution + logging, and an admin
 * page surfaces history.
 */

/** Context passed into every job handler. */
export interface JobContext {
  /** When this run started */
  triggeredAt: Date;
  /** "cron" for scheduled runs, or a user id for manual runs */
  triggeredBy: string;
}

/** What a job handler returns. All fields optional — silent success is fine. */
export interface JobResult {
  /** Free-form summary that lands in JobLog.output */
  output?: string;
  /** Number of items processed — useful for at-a-glance metrics in the admin page */
  processed?: number;
}

/**
 * A scheduled job definition. Add new entries to the JOBS registry in
 * src/lib/jobs/registry.ts to make them runnable.
 *
 * Handlers should be **idempotent** — they may be called more than once
 * for the same time window if cron retries or admins manually trigger.
 * Use `processed` and the JobLog history to track what was already done.
 */
export interface JobDefinition {
  /** Unique key — used in JobLog.jobKey, /api/jobs/run?job=KEY, and the admin UI */
  key: string;
  /** Display name for the admin page */
  name: string;
  /** What this job does — shown on the admin page */
  description: string;
  /**
   * Human-readable schedule string (e.g., "Daily at 6am UTC"). Used for
   * display only — actual scheduling comes from whoever calls the cron
   * endpoint.
   */
  schedule: string;
  /** The job implementation. Should not throw — return a result instead. */
  handler: (ctx: JobContext) => Promise<JobResult>;
}
