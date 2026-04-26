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
 * Resolve the active driver based on environment. Falls back to the log
 * driver if the requested driver doesn't exist, so sendEmail() never
 * throws due to configuration errors.
 */
export function getActiveDriver(): EmailDriver {
  const name = process.env.EMAIL_DRIVER?.toLowerCase() || "log";
  const driver = DRIVERS[name];
  if (!driver) {
    // eslint-disable-next-line no-console
    console.warn(
      `[email] EMAIL_DRIVER="${name}" is not registered. Falling back to log driver.`
    );
    return logDriver;
  }
  return driver;
}

/** Default sender address. Set EMAIL_FROM in env to override. */
export function getDefaultFrom(): string {
  return process.env.EMAIL_FROM || "noreply@opshub.local";
}
