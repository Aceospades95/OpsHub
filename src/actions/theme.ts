"use server";

import { db } from "@/lib/db";
import { requireAuth } from "@/lib/permissions";
import { logActivity } from "@/lib/activity";
import { revalidatePath } from "next/cache";
import { DEFAULT_THEME } from "@/lib/theme-defaults";

const VALID_KEYS = Object.keys(DEFAULT_THEME);

const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

function requireAdmin(role: string) {
  if (role !== "ADMIN") throw new Error("Admin access required");
}

export async function getThemeSettings(): Promise<Record<string, string>> {
  try {
    const rows = await db.themeSetting.findMany();
    const result: Record<string, string> = {};
    for (const row of rows) {
      result[row.key] = row.value;
    }
    return result;
  } catch {
    // DB not available during build — return empty (defaults apply via globals.css)
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

  await db.themeSetting.deleteMany();

  await logActivity("updated", "theme", "global", user.id, "Reset theme to defaults");
  revalidatePath("/", "layout");
  return { success: true };
}
