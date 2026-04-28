"use server";

import { db } from "@/lib/db";
import { requireAuth } from "@/lib/permissions";
import { logActivity } from "@/lib/activity";
import { revalidatePath } from "next/cache";
import { DEFAULT_THEME } from "@/lib/theme-defaults";
import type { ThemePreset } from "@/lib/theme-presets";

const VALID_KEYS = Object.keys(DEFAULT_THEME);

const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;
const CUSTOM_PRESET_PREFIX = "_custom_preset_";

function requireAdmin(role: string) {
  if (role !== "ADMIN") throw new Error("Admin access required");
}

export async function getThemeSettings(): Promise<Record<string, string>> {
  await requireAuth();
  try {
    const rows = await db.themeSetting.findMany({
      where: { key: { not: { startsWith: CUSTOM_PRESET_PREFIX } } },
    });
    const result: Record<string, string> = {};
    for (const row of rows) {
      result[row.key] = row.value;
    }
    return result;
  } catch {
    return {};
  }
}

export async function saveThemeSettings(_prev: unknown, formData: FormData) {
  const user = await requireAuth();
  requireAdmin(user.role);

  const entries: { key: string; value: string }[] = [];

  for (const key of VALID_KEYS) {
    const value = formData.get(key);
    if (typeof value === "string" && value.trim()) {
      const trimmed = value.trim();
      if (!HEX_COLOR_RE.test(trimmed)) {
        return { error: `Invalid color value for "${key}": ${trimmed}` };
      }
      entries.push({ key, value: trimmed });
    }
  }

  if (entries.length === 0) {
    return { error: "No valid theme settings provided" };
  }

  for (const { key, value } of entries) {
    await db.themeSetting.upsert({
      where: { key },
      create: { key, value },
      update: { value },
    });
  }

  await logActivity("updated", "theme", "global", user.id, `Updated ${entries.length} theme settings`);
  revalidatePath("/", "layout");
  return { success: true };
}

export async function resetThemeToDefaults(_prev: unknown) {
  const user = await requireAuth();
  requireAdmin(user.role);

  await db.themeSetting.deleteMany({
    where: { key: { not: { startsWith: CUSTOM_PRESET_PREFIX } } },
  });

  await logActivity("updated", "theme", "global", user.id, "Reset theme to defaults");
  revalidatePath("/", "layout");
  return { success: true };
}

export async function applyPresetTheme(colors: Record<string, string>) {
  const user = await requireAuth();
  requireAdmin(user.role);

  const entries: { key: string; value: string }[] = [];
  for (const key of VALID_KEYS) {
    const value = colors[key];
    if (value && HEX_COLOR_RE.test(value)) {
      entries.push({ key, value });
    }
  }

  for (const { key, value } of entries) {
    await db.themeSetting.upsert({
      where: { key },
      create: { key, value },
      update: { value },
    });
  }

  await logActivity("updated", "theme", "global", user.id, "Applied theme preset");
  revalidatePath("/", "layout");
  return { success: true };
}

export async function getCustomPresets(): Promise<ThemePreset[]> {
  await requireAuth();
  try {
    const rows = await db.themeSetting.findMany({
      where: { key: { startsWith: CUSTOM_PRESET_PREFIX } },
    });
    return rows
      .map((row) => {
        try {
          const parsed = JSON.parse(row.value);
          return {
            id: row.key.replace(CUSTOM_PRESET_PREFIX, ""),
            name: parsed.name,
            description: parsed.description || "Custom theme",
            mode: parsed.mode || "light",
            colors: parsed.colors,
            isCustom: true,
          } as ThemePreset;
        } catch {
          return null;
        }
      })
      .filter((p): p is ThemePreset => p !== null);
  } catch {
    return [];
  }
}

export async function saveCustomPreset(name: string, mode: "light" | "dark", colors: Record<string, string>) {
  const user = await requireAuth();
  requireAdmin(user.role);

  const id = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const key = `${CUSTOM_PRESET_PREFIX}${id}`;

  await db.themeSetting.upsert({
    where: { key },
    create: {
      key,
      value: JSON.stringify({ name, mode, description: `Custom ${mode} theme`, colors }),
    },
    update: {
      value: JSON.stringify({ name, mode, description: `Custom ${mode} theme`, colors }),
    },
  });

  await logActivity("created", "theme-preset", id, user.id, `Saved custom theme "${name}"`);
  revalidatePath("/admin/theme");
  return { success: true, id };
}

export async function deleteCustomPreset(presetId: string) {
  const user = await requireAuth();
  requireAdmin(user.role);

  const key = `${CUSTOM_PRESET_PREFIX}${presetId}`;
  await db.themeSetting.deleteMany({ where: { key } });

  await logActivity("deleted", "theme-preset", presetId, user.id, `Deleted custom theme preset`);
  revalidatePath("/admin/theme");
  return { success: true };
}
