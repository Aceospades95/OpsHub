"use server";

import { db } from "@/lib/db";
import { requireAuth } from "@/lib/permissions";
import { revalidatePath } from "next/cache";
import { executeDataSourceQuery } from "@/lib/widget-builder/data-source-executor";
import { getDataSource } from "@/lib/widget-builder/data-source-registry";
import type { WidgetConfig } from "@/lib/widget-builder/widget-config-types";

export async function listCustomWidgets() {
  try {
    return await db.customWidget.findMany({
      orderBy: { updatedAt: "desc" },
      include: { createdBy: { select: { name: true } } },
    });
  } catch {
    return [];
  }
}

export async function listPublishedCustomWidgets() {
  try {
    return await db.customWidget.findMany({
      where: { isPublished: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true, description: true, category: true, icon: true, config: true },
    });
  } catch {
    return [];
  }
}

export async function getCustomWidget(id: string) {
  return db.customWidget.findUnique({
    where: { id },
    include: { createdBy: { select: { name: true } } },
  });
}

export async function createCustomWidget(data: {
  name: string;
  description?: string;
  config: string;
  icon?: string;
  category?: string;
  isPublished?: boolean;
}) {
  const user = await requireAuth();
  if (user.role !== "ADMIN" && user.role !== "DEVELOPER") {
    return { error: "Admin or Developer access required" };
  }

  // Validate config JSON
  try {
    JSON.parse(data.config);
  } catch {
    return { error: "Invalid widget configuration JSON" };
  }

  const widget = await db.customWidget.create({
    data: {
      name: data.name,
      description: data.description,
      config: data.config,
      icon: data.icon || "BarChart3",
      category: data.category || "data",
      isPublished: data.isPublished || false,
      createdById: user.id,
    },
  });

  revalidatePath("/admin/widgets");
  return { success: true, id: widget.id };
}

export async function updateCustomWidget(
  id: string,
  data: {
    name: string;
    description?: string;
    config: string;
    icon?: string;
    category?: string;
    isPublished?: boolean;
  }
) {
  const user = await requireAuth();
  if (user.role !== "ADMIN" && user.role !== "DEVELOPER") {
    return { error: "Admin or Developer access required" };
  }

  try {
    JSON.parse(data.config);
  } catch {
    return { error: "Invalid widget configuration JSON" };
  }

  await db.customWidget.update({
    where: { id },
    data: {
      name: data.name,
      description: data.description,
      config: data.config,
      icon: data.icon,
      category: data.category,
      isPublished: data.isPublished,
    },
  });

  revalidatePath("/admin/widgets");
  revalidatePath("/", "layout");
  return { success: true };
}

export async function deleteCustomWidget(id: string) {
  const user = await requireAuth();
  if (user.role !== "ADMIN" && user.role !== "DEVELOPER") {
    return { error: "Admin or Developer access required" };
  }

  await db.customWidget.delete({ where: { id } });
  revalidatePath("/admin/widgets");
  revalidatePath("/", "layout");
  return { success: true };
}

export async function toggleCustomWidgetPublished(id: string) {
  const user = await requireAuth();
  if (user.role !== "ADMIN" && user.role !== "DEVELOPER") {
    return { error: "Admin or Developer access required" };
  }

  const widget = await db.customWidget.findUnique({ where: { id } });
  if (!widget) return { error: "Widget not found" };

  await db.customWidget.update({
    where: { id },
    data: { isPublished: !widget.isPublished },
  });

  revalidatePath("/admin/widgets");
  revalidatePath("/", "layout");
  return { success: true, isPublished: !widget.isPublished };
}

export async function previewCustomWidget(configJson: string) {
  const user = await requireAuth();
  if (user.role !== "ADMIN" && user.role !== "DEVELOPER") {
    return { error: "Access denied" };
  }

  let config: WidgetConfig;
  try {
    config = JSON.parse(configJson) as WidgetConfig;
  } catch {
    return { error: "Invalid JSON" };
  }

  const ds = getDataSource(config.dataSourceId);
  if (!ds) return { error: `Data source "${config.dataSourceId}" not found` };

  const data = await executeDataSourceQuery({
    dataSourceId: config.dataSourceId,
    filters: config.filters || [],
    sort: config.sort || ds.defaultSort,
    limit: config.limit || 20,
    aggregation: config.aggregation,
  });

  // Serialize dates for client transport
  const serializedRows = data.rows.map((row) => {
    const sr: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(row)) {
      sr[k] = v instanceof Date ? v.toISOString() : v;
    }
    return sr;
  });

  return { success: true, data: { rows: serializedRows, aggregate: data.aggregate }, fields: ds.fields };
}
