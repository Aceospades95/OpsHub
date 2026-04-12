"use server";

/**
 * Server actions for employee profile files.
 *
 * Files attached to an employee's profile — resumes, signed offer
 * letters, ID photos, training records, certification scans. Visible
 * to the employee, their manager, and admins.
 *
 * All files go through the shared storage layer so they live under the
 * configured driver (local / S3 / ...) and stream through the existing
 * /api/files/{id} route with the normal auth gate.
 */

import { db } from "@/lib/db";
import { requireAuth } from "@/lib/permissions";
import { uploadFile, deleteFile, blobToBuffer } from "@/lib/storage";
import { logActivity } from "@/lib/activity";
import { revalidateUser } from "@/lib/revalidate-entity";

/** Upload size ceiling. Matches the admin upload action. */
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

/**
 * Categories surfaced in the employee files UI. Kept tight on purpose:
 * a free-form list grows forever and makes browsing worse. If someone
 * has a genuinely new kind of document, "other" is always valid.
 */
export const EMPLOYEE_FILE_CATEGORIES = [
  "resume",
  "id",
  "certification",
  "training",
  "contract",
  "other",
] as const;
export type EmployeeFileCategory = (typeof EMPLOYEE_FILE_CATEGORIES)[number];

/**
 * MIME types we accept for employee profile uploads. Wide enough for
 * resumes (PDF/DOCX), scanned IDs (images/PDF), training certificates
 * (PDF/images), spreadsheets for timesheets. Intentionally excludes
 * executables and archives.
 */
const ALLOWED_MIME_TYPES = new Set<string>([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "text/plain",
  "text/csv",
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/heic",
]);

/**
 * Permission check: who can read / upload / delete files on employee X's
 * profile? Returns a flag set; callers throw if the action they need
 * isn't allowed.
 *
 *   - Employees can always manage their own profile files
 *   - ADMIN and MANAGER can manage anyone's
 *   - Everyone else has no access
 */
export async function getEmployeeFilePermissions(targetUserId: string) {
  const user = await requireAuth();
  const isSelf = user.id === targetUserId;
  const isPrivileged = user.role === "ADMIN" || user.role === "MANAGER";
  const canView = isSelf || isPrivileged;
  return {
    viewer: user,
    canView,
    canUpload: canView,
    canDelete: canView,
  };
}

/**
 * Upload a new file to an employee's profile. Form fields:
 *   - userId: target employee id
 *   - category: EmployeeFileCategory (defaults to "other")
 *   - file: the file blob
 */
export async function uploadEmployeeFile(
  _prev: unknown,
  formData: FormData
): Promise<{ success: boolean; error?: string; fileId?: string }> {
  const userIdRaw = formData.get("userId");
  if (typeof userIdRaw !== "string" || !userIdRaw) {
    return { success: false, error: "Missing target user" };
  }
  const { canUpload, viewer } = await getEmployeeFilePermissions(userIdRaw);
  if (!canUpload) {
    return { success: false, error: "You don't have permission to upload files for this employee" };
  }

  const blob = formData.get("file");
  if (!blob || !(blob instanceof File)) {
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

  const mime = blob.type || "application/octet-stream";
  if (!ALLOWED_MIME_TYPES.has(mime)) {
    return {
      success: false,
      error: `File type not allowed: ${mime}. Accepted: PDF, Word, Excel, PowerPoint, text, and common images.`,
    };
  }

  // Narrow category to the allowed enum, fall back to "other" for anything
  // else so a malformed submission doesn't fail — the UI constrains this
  // anyway, but the action is the actual authority.
  const categoryRaw = formData.get("category");
  const category =
    typeof categoryRaw === "string" &&
    EMPLOYEE_FILE_CATEGORIES.includes(categoryRaw as EmployeeFileCategory)
      ? (categoryRaw as EmployeeFileCategory)
      : "other";

  const buffer = await blobToBuffer(blob);
  const file = await uploadFile({
    content: buffer,
    filename: blob.name,
    contentType: mime,
    uploadedById: viewer.id,
    visibility: "private",
    userId: userIdRaw,
    category,
  });

  // Look up the target's name for the activity log. Best-effort — the
  // upload itself has already succeeded, so we don't fail the action if
  // this lookup errors.
  try {
    const target = await db.user.findUnique({
      where: { id: userIdRaw },
      select: { name: true },
    });
    await logActivity(
      "uploaded",
      "user",
      userIdRaw,
      viewer.id,
      `Uploaded ${category} file "${blob.name}" to ${target?.name || "employee"}`
    );
  } catch {
    // swallow — logging is best-effort
  }

  revalidateUser(userIdRaw);
  return { success: true, fileId: file.id };
}

/**
 * Delete a single employee file. Only admins/managers or the file's
 * owner can do this — we check using the userId FK on the File row.
 */
export async function deleteEmployeeFile(fileId: string) {
  const viewer = await requireAuth();

  const file = await db.file.findUnique({
    where: { id: fileId },
    select: { id: true, userId: true, name: true, category: true },
  });
  if (!file) {
    return { success: false, error: "File not found" };
  }
  if (!file.userId) {
    return { success: false, error: "Not an employee file" };
  }

  const { canDelete } = await getEmployeeFilePermissions(file.userId);
  if (!canDelete) {
    return {
      success: false,
      error: "You don't have permission to delete this file",
    };
  }

  await deleteFile(fileId);

  try {
    await logActivity(
      "deleted",
      "user",
      file.userId,
      viewer.id,
      `Removed ${file.category || "profile"} file "${file.name}"`
    );
  } catch {
    // swallow — logging is best-effort
  }

  revalidateUser(file.userId);
  return { success: true };
}
