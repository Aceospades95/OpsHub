"use server";

import { db } from "@/lib/db";
import { requireAuth } from "@/lib/permissions";
import { revalidatePath } from "next/cache";
import type { PageLayoutConfig } from "@/lib/page-layout";

function layoutKey(pageType: string): string {
  return `page_layout_${pageType}`;
}

export async function getPageLayout(pageType: string): Promise<PageLayoutConfig | null> {
  try {
    const setting = await db.themeSetting.findUnique({
      where: { key: layoutKey(pageType) },
    });
    if (setting) {
      return JSON.parse(setting.value) as PageLayoutConfig;
    }
  } catch {
    // DB not available during build
  }
  return null;
}

export async function savePageLayout(pageType: string, config: PageLayoutConfig) {
  const user = await requireAuth();
  if (user.role !== "ADMIN") {
    return { error: "Admin access required" };
  }

  const key = layoutKey(pageType);
  await db.themeSetting.upsert({
    where: { key },
    create: { key, value: JSON.stringify(config) },
    update: { value: JSON.stringify(config) },
  });

  revalidatePath("/", "layout");
  return { success: true };
}

export async function resetPageLayout(pageType: string) {
  const user = await requireAuth();
  if (user.role !== "ADMIN") {
    return { error: "Admin access required" };
  }

  await db.themeSetting.deleteMany({
    where: { key: layoutKey(pageType) },
  });

  revalidatePath("/", "layout");
  return { success: true };
}
