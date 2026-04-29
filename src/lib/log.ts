/**
 * Tiny structured logger.
 *
 * Replaces the ad-hoc `console.error("[scope] thing failed:", err)` pattern
 * scattered across the codebase. Two output modes:
 *
 *   - production (NODE_ENV === "production"): JSON Lines on stderr/stdout,
 *     one line per call, fields flattened. Suitable for piping into a log
 *     aggregator without an additional parser.
 *
 *   - dev: pretty-printed `LEVEL [scope] msg` plus fields on a tab-indented
 *     follow-up line. Easier to scan in a terminal.
 *
 * The error path normalizes Error → { name, message, stack } so a thrown
 * Error never gets stringified to "[object Object]".
 *
 * Deliberately framework-free — no pino, no winston. The shape is:
 *
 *   log.info(scope, msg, fields?)
 *   log.warn(scope, msg, fields?)
 *   log.error(scope, msg, errOrFields?, fields?)
 *
 * Scope is a short stable identifier ("jobs.runner", "workflows.engine.tick",
 * "email.driver.ses") that lets a grep / log query target a specific
 * subsystem without hand-typing free-form prefixes.
 */

type Fields = Record<string, unknown>;
type Level = "debug" | "info" | "warn" | "error";

const isProd = process.env.NODE_ENV === "production";

interface LogRecord {
  ts: string;
  level: Level;
  scope: string;
  msg: string;
  /** Flattened user-supplied fields. */
  [key: string]: unknown;
}

function serializeError(err: unknown): Fields {
  if (err instanceof Error) {
    return {
      err_name: err.name,
      err_msg: err.message,
      // Stack is verbose; keep it in dev/prod but trim to a sane size so
      // a log aggregator doesn't choke on a 200KB Node stack.
      err_stack: err.stack ? err.stack.slice(0, 4000) : undefined,
    };
  }
  if (err === undefined || err === null) return {};
  return { err: String(err) };
}

function emit(level: Level, scope: string, msg: string, fields: Fields): void {
  const record: LogRecord = {
    ts: new Date().toISOString(),
    level,
    scope,
    msg,
    ...fields,
  };

  // Pick the right console method so terminal coloring + log-aggregator
  // routing both work without us hardcoding a stream.
  const sink =
    level === "error"
      ? console.error
      : level === "warn"
        ? console.warn
        : console.log;

  if (isProd) {
    sink(JSON.stringify(record));
    return;
  }

  // Pretty output for development. Strip the structural fields out of
  // the second line so the human reader sees only the user-supplied
  // context.
  const { ts: _ts, level: _l, scope: _s, msg: _m, ...rest } = record;
  const head = `${level.toUpperCase()} [${scope}] ${msg}`;
  if (Object.keys(rest).length === 0) {
    sink(head);
  } else {
    sink(head, rest);
  }
}

export const log = {
  debug(scope: string, msg: string, fields: Fields = {}): void {
    emit("debug", scope, msg, fields);
  },
  info(scope: string, msg: string, fields: Fields = {}): void {
    emit("info", scope, msg, fields);
  },
  warn(scope: string, msg: string, fields: Fields = {}): void {
    emit("warn", scope, msg, fields);
  },
  /**
   * Error logger.
   *
   * Two call shapes:
   *
   *   log.error("scope", "msg", err)              — err merged into fields
   *   log.error("scope", "msg", err, { extra })   — both merged
   *   log.error("scope", "msg", { extra })        — no err, just fields
   */
  error(
    scope: string,
    msg: string,
    errOrFields?: unknown | Fields,
    fields: Fields = {}
  ): void {
    let merged: Fields = { ...fields };
    if (errOrFields !== undefined && errOrFields !== null) {
      if (
        errOrFields instanceof Error ||
        typeof errOrFields === "string" ||
        typeof errOrFields === "number"
      ) {
        merged = { ...serializeError(errOrFields), ...merged };
      } else if (typeof errOrFields === "object") {
        // If the second arg is a plain object, treat it as fields.
        merged = { ...(errOrFields as Fields), ...merged };
      } else {
        merged = { err: String(errOrFields), ...merged };
      }
    }
    emit("error", scope, msg, merged);
  },
};

/**
 * Re-exported for tests so they can override the production check.
 * Production tests don't really make sense here — the JSON branch is
 * deterministic — but keeping the toggle exposed lets future tests
 * switch modes without touching NODE_ENV directly.
 */
export const _testIsProd = isProd;
