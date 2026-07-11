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
import type { ImporterDefinition, ImportRowResult } from "../types";
import {
  applyMode,
  buildResult,
  logImportActivity,
  mergeFillBlanks,
  skipExistsMessage,
  skipNoMatchMessage,
  warnList,
} from "../helpers";

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

  async exportRows() {
    const resources = await db.intranetResource.findMany({
      orderBy: [{ pinned: "desc" }, { sortOrder: "asc" }, { title: "asc" }],
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
    const db = ctx.db; // ALL commit reads/writes go through ctx.db
    const results: ImportRowResult[] = [];

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
      const warnings: string[] = [];
      const title = (raw.title || "").trim();
      if (!title) {
        results.push({ row: rowNumber, status: "failed", message: "Missing title" });
        continue;
      }

      const categoryInput = (raw.category || "").trim();
      const categoryRaw = (categoryInput || "OTHER").toUpperCase();
      const category = VALID_CATEGORIES.includes(categoryRaw as IntranetCategory)
        ? (categoryRaw as IntranetCategory)
        : "OTHER";
      if (categoryInput && !VALID_CATEGORIES.includes(categoryRaw as IntranetCategory)) {
        warnings.push(`Invalid category "${categoryInput}" — defaulted to OTHER`);
      }

      const sortOrderRaw = (raw.sortOrder || "").trim();
      const sortOrder = sortOrderRaw ? parseInt(sortOrderRaw, 10) || 0 : 0;

      const key = intranetMatchKey(title, category);
      if (seenInBatch.has(key)) {
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
      const action = applyMode(existing, ctx.mode);

      try {
        if (action === "update" && existing) {
          let updateData: Partial<typeof data> = data;
          if (ctx.mode === "fill-blanks") {
            const current = await db.intranetResource.findUnique({ where: { id: existing.id } });
            updateData = mergeFillBlanks(current, data);
          }
          const resource = await db.intranetResource.update({
            where: { id: existing.id },
            data: updateData,
          });
          results.push({ row: rowNumber, status: "updated", warnings: warnList(warnings) });
          await logImportActivity(ctx, "imported", "intranetResource", resource.id, `${title} (updated)`);
        } else if (action === "skip") {
          const label = `Resource "${title}" in ${category}`;
          results.push({
            row: rowNumber,
            status: "skipped",
            message: existing ? skipExistsMessage(label) : skipNoMatchMessage(label),
          });
        } else {
          const resource = await db.intranetResource.create({ data });
          existingByKey.set(key, { id: resource.id });
          results.push({ row: rowNumber, status: "imported", warnings: warnList(warnings) });
          await logImportActivity(ctx, "imported", "intranetResource", resource.id, title);
        }
      } catch (err) {
        results.push({
          row: rowNumber,
          status: "failed",
          message: err instanceof Error ? err.message : "DB error",
        });
      }
    }

    return buildResult(results);
  },
};
