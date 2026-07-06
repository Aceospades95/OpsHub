"use server";

import { db } from "@/lib/db";
import { requireAuth } from "@/lib/permissions";
import { logActivity } from "@/lib/activity";
import { revalidatePath } from "next/cache";
import { DEFAULT_SIDEBAR_CONFIG, type SidebarConfig } from "@/lib/sidebar-config";
import { MODULES } from "@/lib/modules";

const SIDEBAR_KEY = "sidebar_config";

/**
 * A saved sidebar config predates any module added after it was saved —
 * without a merge, new modules (e.g. "my") would never appear for
 * installs that ever touched the sidebar editor. Inject missing registry
 * modules into the section matching their declared `section`, falling
 * back to the first section. "my" leads its section (it's the landing
 * page); everything else appends.
 */
function withNewModules(config: SidebarConfig): SidebarConfig {
  const known = new Set(
    config.sections.flatMap((s) => s.items.map((i) => i.key))
  );
  const missing = MODULES.filter((m) => !known.has(m.key));
  if (missing.length === 0) return config;

  const sections = config.sections.map((s) => ({ ...s, items: [...s.items] }));
  for (const mod of missing) {
    const targetId = mod.section === "admin" ? "admin-section" : mod.section;
    const target = sections.find((s) => s.id === targetId) ?? sections[0];
    if (!target) continue;
    if (mod.key === "my") target.items.unshift({ key: mod.key, visible: true });
    else target.items.push({ key: mod.key, visible: true });
  }
  return { sections };
}

export async function getSidebarConfig(): Promise<SidebarConfig> {
  // Sidebar config exposes module keys including admin-only ones — keep
  // it gated to authenticated users so unauthenticated visitors don't
  // see the structure of admin surfaces.
  await requireAuth();
  try {
    const setting = await db.themeSetting.findUnique({ where: { key: SIDEBAR_KEY } });
    if (setting) {
      return withNewModules(JSON.parse(setting.value) as SidebarConfig);
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
