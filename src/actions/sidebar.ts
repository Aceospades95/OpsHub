"use server";

import { db } from "@/lib/db";
import { requireAuth } from "@/lib/permissions";
import { logActivity } from "@/lib/activity";
import { revalidatePath } from "next/cache";
import { DEFAULT_SIDEBAR_CONFIG, type SidebarConfig } from "@/lib/sidebar-config";

const SIDEBAR_KEY = "sidebar_config";

export async function getSidebarConfig(): Promise<SidebarConfig> {
  // Sidebar config exposes module keys including admin-only ones — keep
  // it gated to authenticated users so unauthenticated visitors don't
  // see the structure of admin surfaces.
  await requireAuth();
  try {
    const setting = await db.themeSetting.findUnique({ where: { key: SIDEBAR_KEY } });
    if (setting) {
      return JSON.parse(setting.value) as SidebarConfig;
    }
  } catch {
    // DB not available during build or invalid JSON
  }
  return DEFAULT_SIDEBAR_CONFIG;
}

export async function saveSidebarConfig(config: SidebarConfig) {
  const user = await requireAuth();
  if (user.role !== "ADMIN") {
    return { error: "Admin access required" };
  }

  await db.themeSetting.upsert({
    where: { key: SIDEBAR_KEY },
    create: { key: SIDEBAR_KEY, value: JSON.stringify(config) },
    update: { value: JSON.stringify(config) },
  });

  await logActivity("updated", "sidebar", "config", user.id, "Updated sidebar layout");
  revalidatePath("/", "layout");
  return { success: true };
}

export async function resetSidebarConfig() {
  const user = await requireAuth();
  if (user.role !== "ADMIN") {
    return { error: "Admin access required" };
  }

  await db.themeSetting.deleteMany({ where: { key: SIDEBAR_KEY } });

  await logActivity("updated", "sidebar", "config", user.id, "Reset sidebar to defaults");
  revalidatePath("/", "layout");
  return { success: true };
}
