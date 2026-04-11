/**
 * Storage driver registry — maps driver names to implementations.
 *
 * To add a new driver (S3, Google Drive, Backblaze, etc.):
 *   1. Create a new file like `s3-driver.ts` exporting a StorageDriver
 *   2. Import it here and add it to DRIVERS
 *   3. Set STORAGE_DRIVER env var to the new driver's name in production
 *
 * The local driver is always the fallback — if STORAGE_DRIVER is unset or
 * points to a non-existent driver, we use local so the app keeps working.
 */

import type { StorageDriver } from "./types";
import { localDriver } from "./local-driver";

const DRIVERS: Record<string, StorageDriver> = {
  local: localDriver,
  // s3: s3Driver,         // add when ready
  // drive: driveDriver,
};

/**
 * Resolve the active driver based on environment. Falls back to the local
 * driver if the requested driver doesn't exist, so uploads never crash due
 * to a misconfigured env var.
 */
export function getActiveDriver(): StorageDriver {
  const name = process.env.STORAGE_DRIVER?.toLowerCase() || "local";
  const driver = DRIVERS[name];
  if (!driver) {
    // eslint-disable-next-line no-console
    console.warn(
      `[storage] STORAGE_DRIVER="${name}" is not registered. Falling back to local driver.`
    );
    return localDriver;
  }
  return driver;
}

/**
 * Get a driver by name without going through env config. Used by the
 * route handler to look up the driver a file was stored with, which may
 * differ from the currently active driver (e.g., during migrations).
 */
export function getDriverByName(name: string): StorageDriver | undefined {
  return DRIVERS[name];
}
