"use server";

import { db } from "@/lib/db";
import { requireAuth } from "@/lib/permissions";
import { logActivity } from "@/lib/activity";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { PageWidgetLayout } from "@/lib/widget-registry";

// ─── Page Layout CRUD ───────────────────────────────────

function layoutKey(pageType: string): string {
  return `widget_layout_${pageType}`;
}

export async function getWidgetLayout(pageType: string): Promise<PageWidgetLayout | null> {
  try {
    const setting = await db.themeSetting.findUnique({ where: { key: layoutKey(pageType) } });
    if (setting) return JSON.parse(setting.value) as PageWidgetLayout;
  } catch {
    // DB not available during build
  }
  return null;
}

export async function saveWidgetLayout(pageType: string, config: PageWidgetLayout) {
  const user = await requireAuth();
  if (user.role !== "ADMIN" && user.role !== "DEVELOPER") {
    return { error: "Developer or Admin access required" };
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

export async function resetWidgetLayout(pageType: string) {
  const user = await requireAuth();
  if (user.role !== "ADMIN" && user.role !== "DEVELOPER") {
    return { error: "Developer or Admin access required" };
  }

  await db.themeSetting.deleteMany({ where: { key: layoutKey(pageType) } });
  revalidatePath("/", "layout");
  return { success: true };
}

// ─── Custom Widget CRUD ─────────────────────────────────

const widgetSchema = z.object({
  name: z.string().min(1, "Name is required"),
  description: z.string().optional(),
  type: z.enum(["stat", "embed", "markdown", "data-list"]),
  config: z.string(), // JSON string
});

export async function getCustomWidgets() {
  try {
    return await db.customWidget.findMany({
      orderBy: { name: "asc" },
      include: { createdBy: { select: { name: true } } },
    });
  } catch {
    return [];
  }
}

export async function createCustomWidget(_prev: unknown, formData: FormData) {
  const user = await requireAuth();
  if (user.role !== "ADMIN" && user.role !== "DEVELOPER") {
    return { error: "Developer or Admin access required" };
  }

  const parsed = widgetSchema.safeParse({
    name: formData.get("name"),
    description: formData.get("description") || undefined,
    type: formData.get("type"),
    config: formData.get("config"),
  });

  if (!parsed.success) {
    return { error: parsed.error.errors[0].message };
  }

  // Validate JSON
  try {
    JSON.parse(parsed.data.config);
  } catch {
    return { error: "Invalid JSON config" };
  }

  const widget = await db.customWidget.create({
    data: {
      name: parsed.data.name,
      description: parsed.data.description || null,
      type: parsed.data.type,
      config: parsed.data.config,
      createdById: user.id,
    },
  });

  await logActivity("created", "widget", widget.id, user.id, widget.name);
  revalidatePath("/admin/widgets");
  return { success: true };
}

export async function updateCustomWidget(_prev: unknown, formData: FormData) {
  const user = await requireAuth();
  if (user.role !== "ADMIN" && user.role !== "DEVELOPER") {
    return { error: "Developer or Admin access required" };
  }

  const id = formData.get("id") as string;
  const parsed = widgetSchema.safeParse({
    name: formData.get("name"),
    description: formData.get("description") || undefined,
    type: formData.get("type"),
    config: formData.get("config"),
  });

  if (!parsed.success) return { error: parsed.error.errors[0].message };

  try { JSON.parse(parsed.data.config); } catch { return { error: "Invalid JSON config" }; }

  await db.customWidget.update({
    where: { id },
    data: {
      name: parsed.data.name,
      description: parsed.data.description || null,
      type: parsed.data.type,
      config: parsed.data.config,
    },
  });

  revalidatePath("/admin/widgets");
  return { success: true };
}

export async function deleteCustomWidget(id: string) {
  const user = await requireAuth();
  if (user.role !== "ADMIN" && user.role !== "DEVELOPER") {
    return { error: "Developer or Admin access required" };
  }

  await db.customWidget.delete({ where: { id } });
  revalidatePath("/admin/widgets");
  return { success: true };
}

// ─── Stat Resolution (shared) ───────────────────────────

async function countModel(model: string, filter: Record<string, unknown>): Promise<number> {
  const w = filter as never;
  switch (model) {
    case "client": return db.client.count({ where: w });
    case "project": return db.project.count({ where: w });
    case "contract": return db.contract.count({ where: w });
    case "task": return db.task.count({ where: w });
    case "supplier": return db.supplier.count({ where: w });
    case "user": return db.user.count({ where: w });
    case "tool": return db.tool.count({ where: w });
    case "intranetResource": return db.intranetResource.count({ where: w });
    default: return 0;
  }
}

export async function resolveStatValue(model: string, filter: Record<string, unknown>): Promise<number> {
  try {
    return await countModel(model, filter);
  } catch {
    return 0;
  }
}

// ─── Template CRUD ──────────────────────────────────────

const TEMPLATE_PREFIX = "widget_tpl_";

export interface WidgetTemplate {
  id: string;
  name: string;
  pageType: string;
  config: PageWidgetLayout;
  createdAt: string;
}

export async function saveWidgetTemplate(name: string, pageType: string, config: PageWidgetLayout) {
  const user = await requireAuth();
  if (user.role !== "ADMIN" && user.role !== "DEVELOPER") {
    return { error: "Developer or Admin access required" };
  }

  const id = `${Date.now()}`;
  const template: WidgetTemplate = { id, name, pageType, config, createdAt: new Date().toISOString() };
  const key = `${TEMPLATE_PREFIX}${id}`;
  await db.themeSetting.create({ data: { key, value: JSON.stringify(template) } });
  return { success: true, id };
}

export async function getWidgetTemplates(): Promise<WidgetTemplate[]> {
  try {
    const settings = await db.themeSetting.findMany({ where: { key: { startsWith: TEMPLATE_PREFIX } } });
    return settings.map((s) => JSON.parse(s.value) as WidgetTemplate);
  } catch {
    return [];
  }
}

export async function deleteWidgetTemplate(id: string) {
  const user = await requireAuth();
  if (user.role !== "ADMIN" && user.role !== "DEVELOPER") {
    return { error: "Developer or Admin access required" };
  }
  await db.themeSetting.deleteMany({ where: { key: `${TEMPLATE_PREFIX}${id}` } });
  return { success: true };
}
