/**
 * Intranet resources importer — bulk-create or update internal
 * documentation, announcements, HR policies, and other intranet entries
 * from CSV.
 *
 * Required: title
 * Optional: description, content, category, published, pinned, sortOrder
 *
 * Upsert match key: (title + category) lowercased. Two resources with
 * the same title under the same category are treated as the same row;
 * the same title under a different category is intentionally NOT merged.
 */

import type { IntranetCategory } from "@prisma/client";
import { db } from "@/lib/db";
import { logActivity } from "@/lib/activity";
import type { ImporterDefinition, ImportRowResult } from "../types";

const VALID_CATEGORIES: IntranetCategory[] = [
  "EXPENSE_REPORT",
  "TIME_OFF",
  "ORG_CHART",
  "ANNOUNCEMENT",
  "HR_POLICY",
  "SOP",
  "GENERAL_RESOURCE",
  "FORM",
  "OTHER",
];

function parseBool(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined || value === "") return defaultValue;
  const v = value.trim().toLowerCase();
  if (["false", "no", "0", "off"].includes(v)) return false;
  if (["true", "yes", "1", "on"].includes(v)) return true;
  return defaultValue;
}

function intranetMatchKey(title: string, category: string): string {
  return `${title.trim().toLowerCase()}|${category.trim().toLowerCase()}`;
}

export const intranetImporter: ImporterDefinition = {
  key: "intranet",
  name: "Intranet Resources",
  description:
    "Bulk-create or update intranet resources (announcements, HR policies, SOPs, forms, etc.). Required: title. Optional: description, full content, category, published/pinned flags.",
  module: "intranet",
  supportsUpsert: true,
  upsertKeyDescription:
    "Matched by (title + category), case-insensitive. Re-uploading the same title under the same category updates the existing row; the same title under a different category is treated as a separate resource.",

  fields: [
    { key: "title", label: "Title", required: true, aliases: ["name", "resource", "resource title"] },
    { key: "description", label: "Description", required: false, aliases: ["short description", "summary"] },
    {
      key: "content",
      label: "Content",
      required: false,
      description: "Long-form HTML or markdown body shown on the resource detail page.",
      aliases: ["body", "html"],
    },
    {
      key: "category",
      label: "Category",
      required: false,
      description:
        "EXPENSE_REPORT, TIME_OFF, ORG_CHART, ANNOUNCEMENT, HR_POLICY, SOP, GENERAL_RESOURCE, FORM, OTHER. Defaults to OTHER.",
      aliases: ["type", "kind"],
    },
    {
      key: "published",
      label: "Published",
      required: false,
      description: "true / false. Defaults to false (draft).",
      aliases: ["live", "visible"],
    },
    {
      key: "pinned",
      label: "Pinned",
      required: false,
      description: "true / false. Pinned items show first in their category.",
      aliases: ["sticky"],
    },
    {
      key: "sortOrder",
      label: "Sort order",
      required: false,
      description: "Integer; lower sorts first within the category.",
      aliases: ["order", "position"],
    },
  ],

  async sampleRows() {
    const resources = await db.intranetResource.findMany({
      orderBy: { createdAt: "desc" },
      take: 3,
    });
    return resources.map((r) => ({
      title: r.title,
      description: r.description || "",
      content: r.content || "",
      category: r.category,
      published: r.published ? "true" : "false",
      pinned: r.pinned ? "true" : "false",
      sortOrder: String(r.sortOrder),
    }));
  },

  async commit(rows, ctx) {
    const results: ImportRowResult[] = [];
    let imported = 0;
    let updated = 0;
    let skipped = 0;
    let failed = 0;
    const upsert = ctx.mode === "upsert";

    // Pre-fetch every resource keyed by (lowercased title + category)
    // for upsert matching and in-batch dedupe.
    const existingResources = await db.intranetResource.findMany({
      select: { id: true, title: true, category: true },
    });
    const existingByKey = new Map<string, { id: string }>(
      existingResources.map((r) => [intranetMatchKey(r.title, r.category), { id: r.id }])
    );
    const seenInBatch = new Set<string>();

    for (let i = 0; i < rows.length; i++) {
      const rowNumber = i + 1;
      const raw = rows[i];
      const title = (raw.title || "").trim();
      if (!title) {
        failed++;
        results.push({ row: rowNumber, status: "failed", message: "Missing title" });
        continue;
      }

      const categoryRaw = (raw.category || "OTHER").trim().toUpperCase();
      const category = VALID_CATEGORIES.includes(categoryRaw as IntranetCategory)
        ? (categoryRaw as IntranetCategory)
        : "OTHER";

      const sortOrderRaw = (raw.sortOrder || "").trim();
      const sortOrder = sortOrderRaw ? parseInt(sortOrderRaw, 10) || 0 : 0;

      const key = intranetMatchKey(title, category);
      if (seenInBatch.has(key)) {
        skipped++;
        results.push({
          row: rowNumber,
          status: "skipped",
          message: `Duplicate row in file: "${title}" (${category})`,
        });
        continue;
      }
      seenInBatch.add(key);

      const data = {
        title,
        description: raw.description?.trim() || null,
        content: raw.content?.trim() || null,
        category,
        published: parseBool(raw.published, false),
        pinned: parseBool(raw.pinned, false),
        sortOrder,
      };

      const existing = existingByKey.get(key);

      try {
        if (existing && upsert) {
          const resource = await db.intranetResource.update({
            where: { id: existing.id },
            data,
          });
          updated++;
          results.push({ row: rowNumber, status: "updated" });
          await logActivity("imported", "intranetResource", resource.id, ctx.triggeredBy, `${title} (updated)`);
        } else if (existing && !upsert) {
          skipped++;
          results.push({
            row: rowNumber,
            status: "skipped",
            message: `Resource already exists: "${title}" in ${category}. Re-run with "Update existing rows" enabled to update it.`,
          });
        } else {
          const resource = await db.intranetResource.create({ data });
          existingByKey.set(key, { id: resource.id });
          imported++;
          results.push({ row: rowNumber, status: "imported" });
          await logActivity("imported", "intranetResource", resource.id, ctx.triggeredBy, title);
        }
      } catch (err) {
        failed++;
        results.push({
          row: rowNumber,
          status: "failed",
          message: err instanceof Error ? err.message : "DB error",
        });
      }
    }

    return { imported, updated, skipped, failed, rows: results };
  },
};
