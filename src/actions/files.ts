"use server";

import { db } from "@/lib/db";
import { requireAuth } from "@/lib/permissions";
import { uploadFile, deleteFile, blobToBuffer } from "@/lib/storage";
import { asUploadedFile } from "@/lib/uploaded-file";
import { revalidatePath } from "next/cache";

function requireAdmin(role: string) {
  if (role !== "ADMIN") throw new Error("Admin access required");
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

  const file = await uploadFile({
    content: buffer,
    filename: blob.name,
    contentType: blob.type || "application/octet-stream",
    uploadedById: user.id,
    visibility,
  });

  revalidatePath("/admin/files");
  return { success: true, fileId: file.id };
}

/** Delete a file — admin-only path for the admin viewer. */
export async function adminDeleteFile(fileId: string) {
  const user = await requireAuth();
  requireAdmin(user.role);

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
  requireAdmin(user.role);

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
