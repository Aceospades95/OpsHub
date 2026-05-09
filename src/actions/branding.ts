"use server";

import { requireAuth } from "@/lib/permissions";
import { uploadFile, deleteFile, blobToBuffer, StorageQuotaExceededError } from "@/lib/storage";
import { asUploadedFile } from "@/lib/uploaded-file";
import { sniffUploadType } from "@/lib/upload-validation";
import {
  setBrandingValue,
  getBranding,
  BRANDING_KEYS,
  type BrandingKey,
} from "@/lib/branding";
import { revalidatePath } from "next/cache";
import { log } from "@/lib/log";

function requireAdmin(role: string): { error: string } | null {
  if (role !== "ADMIN") return { error: "Admin access required" };
  return null;
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
  // Top-level safety net. Branding uploads pass through the storage
  // driver (S3 SDK or filesystem), the ThemeSetting table, and a
  // post-upload revalidatePath — any of those can throw with details
  // we don't want crashing the form into the "Application error"
  // page that useFormState surfaces on uncaught throws. Catch
  // everything, log server-side, and surface a friendly inline
  // message to the admin.
  try {
    const user = await requireAuth();
    const gate = requireAdmin(user.role);
    if (gate) return { success: false, error: gate.error };

    const target = formData.get("target") as BrandingKey | null;
    if (target !== "companyLogoFileId" && target !== "backgroundImageFileId") {
      return { success: false, error: "Invalid target" };
    }

    const blob = asUploadedFile(formData.get("file"));
    if (!blob) {
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
    const buffer = await blobToBuffer(blob as unknown as Blob);

    // R11-H: server-side magic-byte sniff. Branding is PUBLIC, so SVG
    // is rejected — a stored <svg> with embedded <script> would
    // execute on any page that renders the logo (login, marketing).
    const sniff = sniffUploadType(buffer, blob.type, { blockSvg: true });
    if (!sniff.ok) {
      return { success: false, error: sniff.reason };
    }

    let file;
    try {
      file = await uploadFile({
        content: buffer,
        filename: blob.name,
        contentType: blob.type,
        uploadedById: user.id,
        visibility: "public",
      });
    } catch (err) {
      if (err instanceof StorageQuotaExceededError) {
        return {
          success: false,
          error: "Your account is at its storage quota. Delete older files first.",
        };
      }
      // Driver errors (S3 missing creds, disk permission, etc.) flow
      // through here. Surface a hint that points the admin at the
      // server logs without leaking the underlying error message.
      log.error("branding.upload", "Storage driver failed", err, {
        target,
        driver: process.env.STORAGE_DRIVER || "local",
      });
      return {
        success: false,
        error:
          "Storage layer rejected the upload. Check STORAGE_DRIVER config and server logs for the underlying error.",
      };
    }

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
      } catch (err) {
        // Best-effort cleanup — failure here doesn't break the upload
        log.warn("branding.upload", "Failed to delete previous file", {
          previousFileId,
          err: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // Branding shows up in the layout, so we have to revalidate everything.
    // Wrap separately because revalidatePath has been observed to throw
    // under specific Next.js dynamic-route configurations and we don't
    // want to surface "upload succeeded but page didn't refresh" as a
    // crash.
    try {
      revalidatePath("/", "layout");
    } catch (err) {
      log.warn("branding.upload", "revalidatePath threw post-upload", {
        err: err instanceof Error ? err.message : String(err),
      });
    }
    return { success: true, fileId: file.id };
  } catch (err) {
    log.error("branding.upload", "Top-level catch", err);
    return {
      success: false,
      error: "Could not upload the image. Check server logs for details.",
    };
  }
}

/**
 * Clear an uploaded branding image — deletes the underlying file and
 * removes the ThemeSetting key so the layout falls back to the default.
 */
export async function clearBrandingImage(target: BrandingKey) {
  try {
    const user = await requireAuth();
    const gate = requireAdmin(user.role);
    if (gate) return gate;

    if (target !== "companyLogoFileId" && target !== "backgroundImageFileId") {
      return { error: "Invalid target" } as const;
    }

    const branding = await getBranding();
    const fileId =
      target === "companyLogoFileId"
        ? branding.companyLogoFileId
        : branding.backgroundImageFileId;

    if (fileId) {
      try {
        await deleteFile(fileId);
      } catch (err) {
        // Best-effort — orphan bytes are recoverable, surface as warn.
        log.warn("branding.clear", "Failed to delete file bytes", {
          fileId,
          err: err instanceof Error ? err.message : String(err),
        });
      }
    }

    await setBrandingValue(BRANDING_KEYS[target], null);
    try {
      revalidatePath("/", "layout");
    } catch (err) {
      log.warn("branding.clear", "revalidatePath threw post-clear", {
        err: err instanceof Error ? err.message : String(err),
      });
    }
    return { success: true } as const;
  } catch (err) {
    log.error("branding.clear", "Top-level catch", err);
    return {
      error: "Could not clear the branding image. Check server logs for details.",
    } as const;
  }
}

/** Update or clear the displayed company name. */
export async function setCompanyName(name: string) {
  try {
    const user = await requireAuth();
    const gate = requireAdmin(user.role);
    if (gate) return gate;

    const trimmed = name.trim();
    await setBrandingValue(BRANDING_KEYS.companyName, trimmed || null);
    try {
      revalidatePath("/", "layout");
    } catch (err) {
      log.warn("branding.setName", "revalidatePath threw post-save", {
        err: err instanceof Error ? err.message : String(err),
      });
    }
    return { success: true } as const;
  } catch (err) {
    log.error("branding.setName", "Top-level catch", err);
    return {
      error: "Could not save the company name. Check server logs for details.",
    } as const;
  }
}
