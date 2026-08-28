"use server";

/**
 * Org-wide module visibility (Settings → Modules). A hidden module
 * drops out of the sidebar for everyone — the pages stay reachable by
 * URL and by admins, so hiding is presentation, not access control
 * (permissions still gate the data). Absence of a row = shown.
 */

import { revalidatePath } from "next/cache";

import { db } from "@/lib/db";
import { logActivity } from "@/lib/activity";
import { getModule } from "@/lib/modules";
import { requireAuth } from "@/lib/permissions";

/** Modules the sidebar refuses to hide (navigation lifelines). */
const NEVER_HIDDEN = new Set(["my", "dashboard", "settings"]);

export async function setModuleHidden(moduleKey: string, hidden: boolean) {
  const user = await requireAuth();
  if (user.role !== "ADMIN") {
    return { success: false as const, error: "Admin access required" };
  }
  const mod = getModule(moduleKey);
  if (!mod) {
    return { success: false as const, error: "Unknown module" };
  }
  if (NEVER_HIDDEN.has(moduleKey)) {
    return { success: false as const, error: "This module can't be hidden" };
  }

  await db.moduleSetting.upsert({
    where: { module: moduleKey },
    create: { module: moduleKey, hiddenInSidebar: hidden === true },
    update: { hiddenInSidebar: hidden === true },
  });
  await logActivity(
    "updated",
    "module-setting",
    moduleKey,
    user.id,
    `${mod.label} ${hidden ? "hidden from" : "shown in"} sidebar`
  );
  // The sidebar renders from the platform layout — revalidate it all.
  revalidatePath("/", "layout");
  revalidatePath("/admin/modules");
  return { success: true as const };
}
