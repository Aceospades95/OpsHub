/**
 * Driver registry — maps driver names to implementations.
 *
 * To add a new provider (Resend, Postmark, SES, etc.):
 *   1. Create a new file like `resend-driver.ts` exporting an EmailDriver
 *   2. Import it here and add it to DRIVERS
 *   3. Set EMAIL_DRIVER env var to the new driver's name in production
 *
 * The LogDriver is always the fallback — if EMAIL_DRIVER is unset or
 * points to a non-existent driver, we log instead of crashing the app.
 */

import { log } from "@/lib/log";
import type { EmailDriver } from "./types";
import { logDriver } from "./log-driver";
import { sesDriver } from "./ses-driver";
import { smtpDriver } from "./smtp-driver";

// Registry of available drivers. Keys are used as EMAIL_DRIVER env values.
const DRIVERS: Record<string, EmailDriver> = {
  log: logDriver,
  ses: sesDriver,
  smtp: smtpDriver,
  // postmark: postmarkDriver,
};

/**
 * Resolve the active driver based on environment.
 *
 * Production safety: if NODE_ENV=production and the resolved driver is
 * `log` (or EMAIL_DRIVER points at an unregistered name and the
 * fallback would be log), we throw rather than silently dropping every
 * customer-facing email. Override with ALLOW_LOG_DRIVER_IN_PROD=true
 * for the rare case (load test, dry run, sandbox env) where the log
 * driver in production is actually intended.
 *
 * The boot-time validator (scripts/validate-env.mjs) catches this
 * earlier, but we keep a runtime guard here as defense-in-depth — env
 * can drift at runtime (operator deletes a var while the container is
 * up) and it's better to fail loud at the next send than to write
 * "sent" rows to EmailLog with no actual delivery.
 */
export function getActiveDriver(): EmailDriver {
  const isProduction = process.env.NODE_ENV === "production";
  const allowLogInProd = process.env.ALLOW_LOG_DRIVER_IN_PROD === "true";
  const name = process.env.EMAIL_DRIVER?.toLowerCase() || "log";
  const driver = DRIVERS[name];

  if (!driver) {
    if (isProduction && !allowLogInProd) {
      throw new Error(
        `EMAIL_DRIVER="${name}" is not a registered driver and falling back to 'log' would silently drop email in production. ` +
          `Valid drivers: ${Object.keys(DRIVERS).join(", ")}. Set EMAIL_DRIVER explicitly, or opt in to log fallback with ALLOW_LOG_DRIVER_IN_PROD=true.`
      );
    }
    log.warn("email.drivers", "EMAIL_DRIVER not registered; falling back to log", {
      requested: name,
    });
    return logDriver;
  }

  if (isProduction && name === "log" && !allowLogInProd) {
    throw new Error(
      `EMAIL_DRIVER=log in production would silently drop every customer-facing email. ` +
        `Set EMAIL_DRIVER=ses (or smtp) and EMAIL_FROM, or opt in explicitly with ALLOW_LOG_DRIVER_IN_PROD=true.`
    );
  }

  return driver;
}

/**
 * Resolve the default sender address.
 *
 * - With EMAIL_DRIVER=log (or unset), we fall back to a placeholder so
 *   local development never blocks on missing config.
 * - With any real driver (smtp, ses, ...) EMAIL_FROM MUST be set —
 *   throwing here surfaces misconfiguration loudly at the first send
 *   instead of letting Gmail/SES bounce a placeholder address.
 */
export function getDefaultFrom(): string {
  const fromEnv = process.env.EMAIL_FROM;
  if (fromEnv) return fromEnv;

  const driverName = process.env.EMAIL_DRIVER?.toLowerCase() || "log";
  if (driverName !== "log") {
    throw new Error(
      `EMAIL_FROM must be set when EMAIL_DRIVER="${driverName}". The placeholder default is only allowed for the log driver.`
    );
  }
  return "noreply@opshub.local";
}
