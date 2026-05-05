/**
 * Intranet resources importer — bulk-create internal documentation,
 * announcements, HR policies, and other intranet entries from CSV.
 *
 * Required: title
 * Optional: description, content, category, published, pinned, sortOrder
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

export const intranetImporter: ImporterDefinition = {
  key: "intranet",
  name: "Intranet Resources",
  description:
    "Bulk-create intranet resources (announcements, HR policies, SOPs, forms, etc.). Required: title. Optional: description, full content, category, published/pinned flags.",
  module: "intranet",

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
    const skipped = 0;
    let failed = 0;

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

      try {
        const resource = await db.intranetResource.create({
          data: {
            title,
            description: raw.description?.trim() || null,
            content: raw.content?.trim() || null,
            category,
            published: parseBool(raw.published, false),
            pinned: parseBool(raw.pinned, false),
            sortOrder,
          },
        });
        imported++;
        results.push({ row: rowNumber, status: "imported" });
        await logActivity("imported", "intranetResource", resource.id, ctx.triggeredBy, title);
      } catch (err) {
        failed++;
        results.push({
          row: rowNumber,
          status: "failed",
          message: err instanceof Error ? err.message : "DB error",
        });
      }
    }

    return { imported, updated: 0, skipped, failed, rows: results };
  },
};
