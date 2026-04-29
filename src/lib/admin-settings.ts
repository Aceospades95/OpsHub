/**
 * Admin-tunable defaults stored in the ThemeSetting key/value table.
 *
 * ThemeSetting was originally just colors but it's a generic key/value
 * store with admin-only writes (gated through saveAdminSetting). Reusing
 * it for non-color settings keeps a single audit + revalidation path
 * instead of inventing yet another table.
 *
 * Keys live here as constants so they're discoverable and not duplicated
 * across actions/pages.
 */

import { db } from "@/lib/db";

export const ADMIN_SETTING_KEYS = {
  /** When true (default) the user-creation flow sends the hardcoded
   *  welcome email. The create-user dialog still lets the admin opt
   *  out per-user — this controls the checkbox's default state and
   *  the `sendWelcomeEmail` server-side fallback when the form
   *  doesn't provide a value (legacy clients, scripts). */
  sendWelcomeEmailDefault: "send_welcome_email_default",
} as const;

export type AdminSettingKey = (typeof ADMIN_SETTING_KEYS)[keyof typeof ADMIN_SETTING_KEYS];

/**
 * Read a boolean admin setting. Falls back to `defaultValue` when the
 * row is missing or the stored value isn't a recognized truthy/falsy
 * literal. Never throws — a misconfigured row should not bring down
 * the create-user flow.
 */
export async function getBooleanAdminSetting(
  key: AdminSettingKey,
  defaultValue: boolean
): Promise<boolean> {
  try {
    const row = await db.themeSetting.findUnique({ where: { key } });
    if (!row) return defaultValue;
    const v = row.value.trim().toLowerCase();
    if (v === "true" || v === "1" || v === "yes") return true;
    if (v === "false" || v === "0" || v === "no") return false;
    return defaultValue;
  } catch {
    return defaultValue;
  }
}

/**
 * Write a boolean admin setting. ADMIN-only — the caller (a server
 * action) is responsible for the role gate; this helper just persists.
 */
export async function setBooleanAdminSetting(
  key: AdminSettingKey,
  value: boolean
): Promise<void> {
  const stringValue = value ? "true" : "false";
  await db.themeSetting.upsert({
    where: { key },
    create: { key, value: stringValue },
    update: { value: stringValue },
  });
}
