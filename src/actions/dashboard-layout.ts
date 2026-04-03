"use server";

import { db } from "@/lib/db";
import { requireAuth } from "@/lib/permissions";
import { revalidatePath } from "next/cache";
import {
  DEFAULT_DASHBOARD,
  type DashboardLayoutConfig,
  type LayoutTemplate,
  type StatWidgetConfig,
  type TaskListConfig,
} from "@/lib/dashboard-widgets";

const LAYOUT_KEY = "dashboard_layout";
const TEMPLATE_PREFIX = "layout_tpl_";

// ─── Layout CRUD ────────────────────────────────────────

export async function getDashboardLayout(): Promise<DashboardLayoutConfig> {
  try {
    const setting = await db.themeSetting.findUnique({ where: { key: LAYOUT_KEY } });
    if (setting) return JSON.parse(setting.value) as DashboardLayoutConfig;
  } catch {
    // DB not available during build
  }
  return DEFAULT_DASHBOARD;
}

export async function saveDashboardLayout(config: DashboardLayoutConfig) {
  const user = await requireAuth();
  if (user.role !== "ADMIN" && user.role !== "DEVELOPER") {
    return { error: "Developer or Admin access required" };
  }

  await db.themeSetting.upsert({
    where: { key: LAYOUT_KEY },
    create: { key: LAYOUT_KEY, value: JSON.stringify(config) },
    update: { value: JSON.stringify(config) },
  });

  revalidatePath("/dashboard");
  return { success: true };
}

export async function resetDashboardLayout() {
  const user = await requireAuth();
  if (user.role !== "ADMIN" && user.role !== "DEVELOPER") {
    return { error: "Developer or Admin access required" };
  }

  await db.themeSetting.deleteMany({ where: { key: LAYOUT_KEY } });
  revalidatePath("/dashboard");
  return { success: true };
}

// ─── Template CRUD ──────────────────────────────────────

export async function saveTemplate(name: string, pageType: string, config: DashboardLayoutConfig) {
  const user = await requireAuth();
  if (user.role !== "ADMIN" && user.role !== "DEVELOPER") {
    return { error: "Developer or Admin access required" };
  }

  const id = `${Date.now()}`;
  const template: LayoutTemplate = {
    id,
    name,
    pageType,
    config,
    createdAt: new Date().toISOString(),
  };

  const key = `${TEMPLATE_PREFIX}${id}`;
  await db.themeSetting.create({
    data: { key, value: JSON.stringify(template) },
  });

  return { success: true, id };
}

export async function getTemplates(): Promise<LayoutTemplate[]> {
  try {
    const settings = await db.themeSetting.findMany({
      where: { key: { startsWith: TEMPLATE_PREFIX } },
    });
    return settings.map((s) => JSON.parse(s.value) as LayoutTemplate);
  } catch {
    return [];
  }
}

export async function deleteTemplate(id: string) {
  const user = await requireAuth();
  if (user.role !== "ADMIN" && user.role !== "DEVELOPER") {
    return { error: "Developer or Admin access required" };
  }

  await db.themeSetting.deleteMany({ where: { key: `${TEMPLATE_PREFIX}${id}` } });
  return { success: true };
}

export async function applyTemplate(templateId: string) {
  const user = await requireAuth();
  if (user.role !== "ADMIN" && user.role !== "DEVELOPER") {
    return { error: "Developer or Admin access required" };
  }

  const setting = await db.themeSetting.findUnique({
    where: { key: `${TEMPLATE_PREFIX}${templateId}` },
  });
  if (!setting) return { error: "Template not found" };

  const template = JSON.parse(setting.value) as LayoutTemplate;

  await db.themeSetting.upsert({
    where: { key: LAYOUT_KEY },
    create: { key: LAYOUT_KEY, value: JSON.stringify(template.config) },
    update: { value: JSON.stringify(template.config) },
  });

  revalidatePath("/dashboard");
  return { success: true };
}

// ─── Stat Resolution ────────────────────────────────────

async function countModel(model: string, filter: Record<string, unknown>): Promise<number> {
  // Dynamic model counting - filter is a Prisma where clause from the widget config
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

export async function resolveStatValue(config: StatWidgetConfig): Promise<number> {
  try {
    return await countModel(config.model, config.filter || {});
  } catch {
    return 0;
  }
}

export async function resolveAllStats(
  widgets: { id: string; type: string; config: StatWidgetConfig | TaskListConfig | Record<string, unknown> }[]
): Promise<Record<string, number>> {
  const results: Record<string, number> = {};
  const statWidgets = widgets.filter((w) => w.type === "stat");

  await Promise.all(
    statWidgets.map(async (w) => {
      results[w.id] = await resolveStatValue(w.config as StatWidgetConfig);
    })
  );

  return results;
}

export async function getTasksForWidget(userId: string, scope: string, limit: number) {
  const where = scope === "mine"
    ? { status: { in: ["TODO" as const, "IN_PROGRESS" as const] }, assigneeId: userId }
    : { status: { in: ["TODO" as const, "IN_PROGRESS" as const] } };

  return db.task.findMany({
    where,
    take: limit,
    orderBy: [{ priority: "asc" }, { dueDate: "asc" }],
    include: {
      project: { select: { id: true, name: true } },
      client: { select: { id: true, name: true } },
      assignee: { select: { name: true } },
    },
  });
}

export async function getActivityForWidget() {
  return db.activityLog.findMany({
    take: 10,
    orderBy: { createdAt: "desc" },
    include: { user: { select: { name: true } } },
  });
}

export async function getAlertData() {
  const expiringContracts = await db.contract.count({
    where: { status: { in: ["EXPIRING_SOON", "EXPIRED"] } },
  });
  return { expiringContracts };
}
