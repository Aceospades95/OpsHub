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
  /**
   * Preview mode: evaluate everything and EXPLAIN what would happen in
   * `output`, but write nothing and send nothing. Only honored by jobs
   * that declare `supportsDryRun` — the runner refuses to dry-run
   * anything else, so a handler can never accidentally execute for
   * real under a "preview" label. Handlers must also bypass their
   * cadence gate when set (a preview should always evaluate).
   */
  dryRun?: boolean;
}

/** What a job handler returns. All fields optional — silent success is fine. */
export interface JobResult {
  /** Free-form summary that lands in JobLog.output */
  output?: string;
  /** Number of items processed — useful for at-a-glance metrics in the admin page */
  processed?: number;
  /**
   * Optional handler-driven status override. When omitted the runner
   * records "completed". Set to "skipped" from a cadence gate (see
   * src/lib/jobs/gating.ts) so the JobLog row reflects "evaluated but
   * intentionally not run" rather than "ran successfully".
   */
  status?: "skipped";
}

/**
 * One tunable knob a job exposes to /admin/jobs/[jobKey]. The stored
 * values live in JobConfig.params (JSON); handlers read them merged
 * over code defaults via getJobParams().
 */
export interface JobParamField {
  /** Key inside JobConfig.params and the defaults object. */
  key: string;
  label: string;
  type: "number" | "boolean";
  help?: string;
  min?: number;
  /**
   * The code default, shown as the form placeholder. Keep in sync with
   * the handler's getJobParams defaults (optional so declaring the
   * schema stays lightweight; the handler's defaults are authoritative).
   */
  defaultValue?: number | boolean;
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
  /**
   * True when the handler honors `ctx.dryRun` (evaluates + explains,
   * writes nothing). Gates the admin "Preview" button and the runner's
   * dryRun option.
   */
  supportsDryRun?: boolean;
  /**
   * Declares the job's tunable parameters. When present,
   * /admin/jobs/[jobKey] renders an editable settings form; the handler
   * reads merged values via getJobParams(key, defaults). Omit for jobs
   * with nothing to tune.
   */
  paramsSchema?: JobParamField[];
  /** The job implementation. Should not throw — return a result instead. */
  handler: (ctx: JobContext) => Promise<JobResult>;
}
