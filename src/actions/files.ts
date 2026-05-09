"use server";

import { db } from "@/lib/db";
import { requireAuth } from "@/lib/permissions";
import { uploadFile, deleteFile, blobToBuffer, StorageQuotaExceededError } from "@/lib/storage";
import { asUploadedFile } from "@/lib/uploaded-file";
import { sniffUploadType } from "@/lib/upload-validation";
import { revalidatePath } from "next/cache";

function requireAdmin(role: string): { error: string } | null {
  if (role !== "ADMIN") return { error: "Admin access required" };
  return null;
}

/** Hard limit so a runaway upload can't fill the disk. 10MB by default. */
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

/**
 * Upload a file submitted via FormData. Used by the admin test upload form
 * and as a reference for how feature-specific upload actions should work.
 */
export async function uploadFileFromForm(
  _prev: unknown,
  formData: FormData
): Promise<{ success: boolean; error?: string; fileId?: string }> {
  const user = await requireAuth();

  const blob = asUploadedFile(formData.get("file"));
  if (!blob) {
    return { success: false, error: "No file provided" };
  }
  if (blob.size === 0) {
    return { success: false, error: "File is empty" };
  }
  if (blob.size > MAX_UPLOAD_BYTES) {
    return {
      success: false,
      error: `File exceeds ${MAX_UPLOAD_BYTES / 1024 / 1024}MB limit`,
    };
  }

  const visibility =
    formData.get("visibility") === "public" ? "public" : "private";

  const buffer = await blobToBuffer(blob as unknown as Blob);

  // R11-H: server-side magic-byte sniff. Public uploads block SVG
  // entirely (XSS risk via inline <script>); private uploads still
  // sniff the bytes so a renamed-extension binary can't slip in.
  const sniff = sniffUploadType(buffer, blob.type || "", {
    blockSvg: visibility === "public",
  });
  if (!sniff.ok) {
    return { success: false, error: sniff.reason };
  }

  let file;
  try {
    file = await uploadFile({
      content: buffer,
      filename: blob.name,
      contentType: blob.type || "application/octet-stream",
      uploadedById: user.id,
      visibility,
    });
  } catch (err) {
    if (err instanceof StorageQuotaExceededError) {
      return {
        success: false,
        error: `Storage quota reached (${(err.quota / 1024 / 1024 / 1024).toFixed(1)} GB). Delete older files or contact an administrator.`,
      };
    }
    throw err;
  }

  revalidatePath("/admin/files");
  return { success: true, fileId: file.id };
}

/** Delete a file — admin-only path for the admin viewer. */
export async function adminDeleteFile(fileId: string) {
  const user = await requireAuth();
  const gate = requireAdmin(user.role);
  if (gate) return gate;

  await deleteFile(fileId);
  revalidatePath("/admin/files");
  return { success: true };
}

/**
 * Purge stale legacy File rows that don't have a storageDriver set AND
 * aren't attached to any entity. Useful during migration — not wired
 * into any UI, just available for future admin tooling.
 */
export async function purgeOrphanLegacyFiles() {
  const user = await requireAuth();
  const gate = requireAdmin(user.role);
  if (gate) return gate;

  const result = await db.file.deleteMany({
    where: {
      storageDriver: null,
      projectId: null,
      contractId: null,
      documentId: null,
      supplierId: null,
      intranetResourceId: null,
      certificationId: null,
    },
  });

  revalidatePath("/admin/files");
  return { success: true, deleted: result.count };
}
