/**
 * Branding helpers — read the current branding config (company name, logo,
 * background image) and return URLs ready for use in `<img src>` and CSS.
 *
 * Branding lives in the existing ThemeSetting key/value store under the
 * `branding.*` namespace, so no schema migration is needed. The actual
 * image bytes are stored via the file storage layer (session 6) with
 * public visibility, and we look up the File row to derive the serving
 * URL.
 *
 * Storage keys:
 *   branding.companyName              → string
 *   branding.companyLogoFileId        → File.id (public visibility)
 *   branding.backgroundImageFileId    → File.id (public visibility)
 */

import { db } from "@/lib/db";
import { getFileUrl, getFileForServing } from "@/lib/storage";
import { log } from "@/lib/log";

export const BRANDING_KEYS = {
  companyName: "branding.companyName",
  companyLogoFileId: "branding.companyLogoFileId",
  backgroundImageFileId: "branding.backgroundImageFileId",
} as const;

export type BrandingKey = keyof typeof BRANDING_KEYS;

export interface BrandingSettings {
  /** Display name shown in the sidebar / header. Falls back to "OpsHub". */
  companyName: string | null;
  /** File id of the uploaded logo, or null. */
  companyLogoFileId: string | null;
  /** Public serving URL for the logo (`/api/files/{id}`), or null. */
  companyLogoUrl: string | null;
  /** File id of the uploaded background image, or null. */
  backgroundImageFileId: string | null;
  /** Public serving URL for the background image, or null. */
  backgroundImageUrl: string | null;
}

/**
 * Read the full branding state in a single call. Used by the platform
 * layout, the login page, and the admin theme editor.
 *
 * Looks up the file rows for any uploaded images so we know they actually
 * exist before returning a URL — a stale ThemeSetting pointing at a
 * deleted File will be reported as null instead of broken `<img src>`.
 *
 * Round-7 QA: also verifies the underlying storage object exists. The
 * File DB row can outlive the actual bytes (e.g. the storage backend
 * was reset, or the local-driver volume was wiped between deploys).
 * Without this check the layout would render an `<img>` whose
 * `/api/files/<id>` request 404s on every navigation, generating
 * the network-spam the QA report flagged.
 */
async function fileBytesExist(fileId: string): Promise<boolean> {
  const meta = await getFileForServing(fileId);
  if (!meta) return false;
  try {
    return await meta.driver.exists(meta.storageKey);
  } catch (err) {
    // exists() throwing is treated as "we can't confirm" — be safe and
    // hide the URL so the page doesn't spam the broken endpoint.
    log.error("branding.exists", "Storage exists() check failed", err, { fileId });
    return false;
  }
}

export async function getBranding(): Promise<BrandingSettings> {
  const rows = await db.themeSetting.findMany({
    where: { key: { in: Object.values(BRANDING_KEYS) } },
  });

  const map = new Map(rows.map((r) => [r.key, r.value]));
  const companyName = map.get(BRANDING_KEYS.companyName) || null;
  const companyLogoFileId = map.get(BRANDING_KEYS.companyLogoFileId) || null;
  const backgroundImageFileId = map.get(BRANDING_KEYS.backgroundImageFileId) || null;

  // Verify the file rows still exist before returning URLs
  const fileIds = [companyLogoFileId, backgroundImageFileId].filter(
    (id): id is string => id !== null
  );
  let existingFileIds = new Set<string>();
  if (fileIds.length > 0) {
    const files = await db.file.findMany({
      where: { id: { in: fileIds } },
      select: { id: true },
    });
    existingFileIds = new Set(files.map((f) => f.id));
  }

  // For every File row that survived the DB check, also confirm the
  // backing storage object is present. Two round-trips for the
  // typical "logo + background" pair when both are configured; cheap
  // enough on a layout-level call.
  const logoOk =
    companyLogoFileId !== null &&
    existingFileIds.has(companyLogoFileId) &&
    (await fileBytesExist(companyLogoFileId));
  const backgroundOk =
    backgroundImageFileId !== null &&
    existingFileIds.has(backgroundImageFileId) &&
    (await fileBytesExist(backgroundImageFileId));

  return {
    companyName,
    companyLogoFileId: logoOk ? companyLogoFileId : null,
    companyLogoUrl: logoOk ? getFileUrl(companyLogoFileId!) : null,
    backgroundImageFileId: backgroundOk ? backgroundImageFileId : null,
    backgroundImageUrl: backgroundOk ? getFileUrl(backgroundImageFileId!) : null,
  };
}

/** Set a branding key. Pass null to clear. */
export async function setBrandingValue(
  key: (typeof BRANDING_KEYS)[BrandingKey],
  value: string | null
) {
  if (value === null || value === "") {
    await db.themeSetting.deleteMany({ where: { key } });
    return;
  }
  await db.themeSetting.upsert({
    where: { key },
    create: { key, value },
    update: { value },
  });
}
