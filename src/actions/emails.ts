"use server";

import { db } from "@/lib/db";
import { requireAuth } from "@/lib/permissions";
import { sendFromTemplate } from "@/lib/email";
import { revalidatePath } from "next/cache";

function requireAdmin(role: string) {
  if (role !== "ADMIN") throw new Error("Admin access required");
}

/**
 * Send a test email to the currently signed-in admin. Useful for verifying
 * the pipeline is wired up without touching real customer-facing templates.
 */
export async function sendTestEmail() {
  const user = await requireAuth();
  requireAdmin(user.role);

  const result = await sendFromTemplate(
    "test",
    { to: user.email },
    {
      to: user.email,
      entityType: "user",
      entityId: user.id,
    }
  );

  revalidatePath("/admin/emails");
  return result;
}

/**
 * Delete a single email log entry. Only admins can purge.
 */
export async function deleteEmailLog(id: string) {
  const user = await requireAuth();
  requireAdmin(user.role);

  await db.emailLog.delete({ where: { id } });
  revalidatePath("/admin/emails");
  return { success: true };
}
