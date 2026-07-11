"use server";

import { db } from "@/lib/db";
import { requireAuth } from "@/lib/permissions";
import { deleteFile } from "@/lib/storage";
import { revalidatePath } from "next/cache";

function requireAdmin(role: string): { error: string } | null {
  if (role !== "ADMIN") return { error: "Admin access required" };
  return null;
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
