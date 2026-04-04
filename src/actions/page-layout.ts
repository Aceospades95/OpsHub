"use server";

import { db } from "@/lib/db";
import { requireAuth } from "@/lib/permissions";
import { revalidatePath } from "next/cache";
import type { PageLayoutConfig, LayoutTemplate } from "@/lib/page-layout";

function layoutKey(pageType: string): string {
  return `page_layout_${pageType}`;
}

function templateKey(pageType: string, name: string): string {
  return `layout_template_${pageType}_${name}`;
}

function templatePrefix(pageType: string): string {
  return `layout_template_${pageType}_`;
}

export async function getPageLayout(pageType: string): Promise<PageLayoutConfig | null> {
  try {
    const setting = await db.themeSetting.findUnique({ where: { key: layoutKey(pageType) } });
    if (setting) return JSON.parse(setting.value) as PageLayoutConfig;
  } catch {
    // DB not available during build
  }
  return null;
}

export async function savePageLayout(pageType: string, config: PageLayoutConfig) {
  const user = await requireAuth();
  if (user.role !== "ADMIN" && user.role !== "DEVELOPER") {
    return { error: "Developer or Admin access required" };
  }

  await db.themeSetting.upsert({
    where: { key: layoutKey(pageType) },
    create: { key: layoutKey(pageType), value: JSON.stringify(config) },
    update: { value: JSON.stringify(config) },
  });

  revalidatePath("/", "layout");
  return { success: true };
}

export async function resetPageLayout(pageType: string) {
  const user = await requireAuth();
  if (user.role !== "ADMIN" && user.role !== "DEVELOPER") {
    return { error: "Developer or Admin access required" };
  }

  await db.themeSetting.deleteMany({ where: { key: layoutKey(pageType) } });
  revalidatePath("/", "layout");
  return { success: true };
}

// --- Template CRUD ---

export async function saveLayoutTemplate(pageType: string, name: string, config: PageLayoutConfig) {
  const user = await requireAuth();
  if (user.role !== "ADMIN" && user.role !== "DEVELOPER") {
    return { error: "Developer or Admin access required" };
  }

  const template: LayoutTemplate = {
    name,
    pageType,
    config,
    createdAt: new Date().toISOString(),
  };

  const key = templateKey(pageType, name);
  await db.themeSetting.upsert({
    where: { key },
    create: { key, value: JSON.stringify(template) },
    update: { value: JSON.stringify(template) },
  });

  return { success: true };
}

export async function getLayoutTemplates(pageType: string): Promise<LayoutTemplate[]> {
  try {
    const prefix = templatePrefix(pageType);
    const settings = await db.themeSetting.findMany({
      where: { key: { startsWith: prefix } },
      orderBy: { updatedAt: "desc" },
    });
    return settings.map((s) => JSON.parse(s.value) as LayoutTemplate);
  } catch {
    return [];
  }
}

export async function deleteLayoutTemplate(pageType: string, name: string) {
  const user = await requireAuth();
  if (user.role !== "ADMIN" && user.role !== "DEVELOPER") {
    return { error: "Developer or Admin access required" };
  }

  await db.themeSetting.deleteMany({ where: { key: templateKey(pageType, name) } });
  return { success: true };
}

export async function loadLayoutTemplate(pageType: string, name: string) {
  const user = await requireAuth();
  if (user.role !== "ADMIN" && user.role !== "DEVELOPER") {
    return { error: "Developer or Admin access required" };
  }

  const key = templateKey(pageType, name);
  const setting = await db.themeSetting.findUnique({ where: { key } });
  if (!setting) return { error: "Template not found" };

  const template = JSON.parse(setting.value) as LayoutTemplate;
  // Apply template as current layout
  await db.themeSetting.upsert({
    where: { key: layoutKey(pageType) },
    create: { key: layoutKey(pageType), value: JSON.stringify(template.config) },
    update: { value: JSON.stringify(template.config) },
  });

  revalidatePath("/", "layout");
  return { success: true };
}
