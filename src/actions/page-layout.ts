"use server";

import { db } from "@/lib/db";
import { requireAuth } from "@/lib/permissions";
import { revalidatePath } from "next/cache";
import { PAGE_CARDS, type PageLayoutConfig, type LayoutTemplate } from "@/lib/page-layout";

// Closed allowlist of page types — pageType is concatenated into the
// ThemeSetting key, so an arbitrary string would let a caller write (or
// clobber) unrelated keys in that table. PAGE_CARDS is the registry of
// every page that supports custom layouts.
const VALID_PAGE_TYPES = new Set(Object.keys(PAGE_CARDS));

const MAX_TEMPLATE_NAME_LENGTH = 100;

function layoutKey(pageType: string): string {
  return `page_layout_${pageType}`;
}

function templateKey(pageType: string, name: string): string {
  // Collision note: pageType comes from the allowlist (no underscores in
  // any key), so the key parses unambiguously even though `name` is free
  // text. Don't add underscores to PAGE_CARDS keys.
  return `layout_template_${pageType}_${name}`;
}

/**
 * Validate a template name: non-empty after trimming, bounded length.
 * Returns the trimmed name or null when invalid.
 */
function validTemplateName(name: string): string | null {
  const trimmed = name?.trim() ?? "";
  if (!trimmed || trimmed.length > MAX_TEMPLATE_NAME_LENGTH) return null;
  return trimmed;
}

export async function getPageLayout(pageType: string): Promise<PageLayoutConfig | null> {
  // Layout shape leaks the structure of detail pages (e.g. which cards
  // exist, in what order). Authenticated users only.
  await requireAuth();
  if (!VALID_PAGE_TYPES.has(pageType)) return null;
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
  if (!VALID_PAGE_TYPES.has(pageType)) return { error: "Unknown page type" };

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
  if (!VALID_PAGE_TYPES.has(pageType)) return { error: "Unknown page type" };

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
  if (!VALID_PAGE_TYPES.has(pageType)) return { error: "Unknown page type" };
  const validName = validTemplateName(name);
  if (!validName) {
    return { error: `Template name must be 1-${MAX_TEMPLATE_NAME_LENGTH} characters` };
  }

  const template: LayoutTemplate = {
    name: validName,
    pageType,
    config,
    createdAt: new Date().toISOString(),
  };

  const key = templateKey(pageType, validName);
  await db.themeSetting.upsert({
    where: { key },
    create: { key, value: JSON.stringify(template) },
    update: { value: JSON.stringify(template) },
  });

  return { success: true };
}

/** Fetch ALL layout templates across all page types */
export async function getAllLayoutTemplates(): Promise<LayoutTemplate[]> {
  await requireAuth();
  try {
    const settings = await db.themeSetting.findMany({
      where: { key: { startsWith: "layout_template_" } },
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
  if (!VALID_PAGE_TYPES.has(pageType)) return { error: "Unknown page type" };
  const validName = validTemplateName(name);
  if (!validName) return { error: "Invalid template name" };

  await db.themeSetting.deleteMany({ where: { key: templateKey(pageType, validName) } });
  return { success: true };
}

export async function loadLayoutTemplate(pageType: string, templatePageType: string, name: string) {
  const user = await requireAuth();
  if (user.role !== "ADMIN" && user.role !== "DEVELOPER") {
    return { error: "Developer or Admin access required" };
  }
  if (!VALID_PAGE_TYPES.has(pageType) || !VALID_PAGE_TYPES.has(templatePageType)) {
    return { error: "Unknown page type" };
  }
  const validName = validTemplateName(name);
  if (!validName) return { error: "Invalid template name" };

  const key = templateKey(templatePageType, validName);
  const setting = await db.themeSetting.findUnique({ where: { key } });
  if (!setting) return { error: "Template not found" };

  const template = JSON.parse(setting.value) as LayoutTemplate;
  // Apply template as current layout for the target page type
  await db.themeSetting.upsert({
    where: { key: layoutKey(pageType) },
    create: { key: layoutKey(pageType), value: JSON.stringify(template.config) },
    update: { value: JSON.stringify(template.config) },
  });

  revalidatePath("/", "layout");
  return { success: true };
}
