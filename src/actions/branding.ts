"use server";

import { requireAuth } from "@/lib/permissions";
import { uploadFile, deleteFile, blobToBuffer } from "@/lib/storage";
import {
  setBrandingValue,
  getBranding,
  BRANDING_KEYS,
  type BrandingKey,
} from "@/lib/branding";
import { revalidatePath } from "next/cache";

function requireAdmin(role: string) {
  if (role !== "ADMIN") throw new Error("Admin access required");
}

/** Max upload size for branding images — keep small since they're shown everywhere */
const MAX_BRANDING_BYTES = 5 * 1024 * 1024; // 5 MB

/**
 * Upload a logo or background image and store the resulting File id in
 * the matching ThemeSetting key. If a previous file is replaced, the old
 * one is deleted from storage so we don't accumulate orphans.
 *
 * Branding files are stored as PUBLIC visibility so unauthenticated
 * pages (login) and cached `<img>` tags can serve them efficiently.
 */
export async function uploadBrandingImage(
  _prev: unknown,
  formData: FormData
): Promise<{ success: boolean; error?: string; fileId?: string }> {
  const user = await requireAuth();
  requireAdmin(user.role);

  const target = formData.get("target") as BrandingKey | null;
  if (target !== "companyLogoFileId" && target !== "backgroundImageFileId") {
    return { success: false, error: "Invalid target" };
  }

  const blob = formData.get("file");
  if (!blob || !(blob instanceof File)) {
    return { success: false, error: "No file provided" };
  }
  if (blob.size === 0) {
    return { success: false, error: "File is empty" };
  }
  if (blob.size > MAX_BRANDING_BYTES) {
    return {
      success: false,
      error: `File exceeds ${MAX_BRANDING_BYTES / 1024 / 1024}MB limit`,
    };
  }
  if (!blob.type.startsWith("image/")) {
    return { success: false, error: "File must be an image" };
  }

  // Upload the new file first so we have a valid replacement before
  // deleting the old one (no broken state if upload fails)
  const buffer = await blobToBuffer(blob);
  const file = await uploadFile({
    content: buffer,
    filename: blob.name,
    contentType: blob.type,
    uploadedById: user.id,
    visibility: "public",
  });

  // Find any existing file under this key and clean it up
  const previous = await getBranding();
  const previousFileId =
    target === "companyLogoFileId"
      ? previous.companyLogoFileId
      : previous.backgroundImageFileId;

  await setBrandingValue(BRANDING_KEYS[target], file.id);

  if (previousFileId && previousFileId !== file.id) {
    try {
      await deleteFile(previousFileId);
    } catch {
      // Best-effort cleanup — failure here doesn't break the upload
    }
  }

  // Branding shows up in the layout, so we have to revalidate everything
  revalidatePath("/", "layout");
  return { success: true, fileId: file.id };
}

/**
 * Clear an uploaded branding image — deletes the underlying file and
 * removes the ThemeSetting key so the layout falls back to the default.
 */
export async function clearBrandingImage(target: BrandingKey) {
  const user = await requireAuth();
  requireAdmin(user.role);

  if (target !== "companyLogoFileId" && target !== "backgroundImageFileId") {
    throw new Error("Invalid target");
  }

  const branding = await getBranding();
  const fileId =
    target === "companyLogoFileId"
      ? branding.companyLogoFileId
      : branding.backgroundImageFileId;

  if (fileId) {
    try {
      await deleteFile(fileId);
    } catch {
      // Best-effort
    }
  }

  await setBrandingValue(BRANDING_KEYS[target], null);
  revalidatePath("/", "layout");
  return { success: true };
}

/** Update or clear the displayed company name. */
export async function setCompanyName(name: string) {
  const user = await requireAuth();
  requireAdmin(user.role);

  const trimmed = name.trim();
  await setBrandingValue(BRANDING_KEYS.companyName, trimmed || null);
  revalidatePath("/", "layout");
  return { success: true };
}
