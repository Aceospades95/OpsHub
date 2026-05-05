/**
 * Tools importer — bulk-create internal/external tool entries from CSV.
 *
 * Required: name
 * Optional: description, category, toolUrl, toolType, isGlobal
 */

import { db } from "@/lib/db";
import { logActivity } from "@/lib/activity";
import type { ImporterDefinition, ImportRowResult } from "../types";

const VALID_TYPES = ["internal", "external", "embedded"] as const;
type ToolType = (typeof VALID_TYPES)[number];

function parseBool(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined || value === "") return defaultValue;
  const v = value.trim().toLowerCase();
  if (["false", "no", "0", "off"].includes(v)) return false;
  if (["true", "yes", "1", "on"].includes(v)) return true;
  return defaultValue;
}

export const toolsImporter: ImporterDefinition = {
  key: "tools",
  name: "Tools",
  description:
    "Bulk-create tool entries. Required: name. Optional: description, category, URL, tool type, global flag.",
  module: "tools",

  fields: [
    { key: "name", label: "Name", required: true, aliases: ["tool", "tool name"] },
    { key: "description", label: "Description", required: false, aliases: ["notes", "summary"] },
    {
      key: "category",
      label: "Category",
      required: false,
      description: "Freeform tag, e.g. form, calculator, tracker, report, automation, other.",
      aliases: ["type", "kind"],
    },
    {
      key: "toolUrl",
      label: "Tool URL",
      required: false,
      description: "External link the tool launches (when toolType is external or embedded).",
      aliases: ["url", "link"],
    },
    {
      key: "toolType",
      label: "Tool type",
      required: false,
      description: "internal, external, or embedded. Defaults to internal.",
      aliases: ["mode"],
    },
    {
      key: "isGlobal",
      label: "Global",
      required: false,
      description: "true / false. true makes the tool available across all projects. Defaults to true.",
      aliases: ["global"],
    },
  ],

  async sampleRows() {
    const tools = await db.tool.findMany({
      orderBy: { createdAt: "desc" },
      take: 3,
    });
    return tools.map((t) => ({
      name: t.name,
      description: t.description || "",
      category: t.category || "",
      toolUrl: t.toolUrl || "",
      toolType: t.toolType,
      isGlobal: t.isGlobal ? "true" : "false",
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
      const name = (raw.name || "").trim();
      if (!name) {
        failed++;
        results.push({ row: rowNumber, status: "failed", message: "Missing name" });
        continue;
      }

      const toolTypeRaw = (raw.toolType || "internal").trim().toLowerCase();
      const toolType: ToolType = (VALID_TYPES as readonly string[]).includes(toolTypeRaw)
        ? (toolTypeRaw as ToolType)
        : "internal";

      try {
        const tool = await db.tool.create({
          data: {
            name,
            description: raw.description?.trim() || null,
            category: raw.category?.trim() || null,
            toolUrl: raw.toolUrl?.trim() || null,
            toolType,
            isGlobal: parseBool(raw.isGlobal, true),
          },
        });
        imported++;
        results.push({ row: rowNumber, status: "imported" });
        await logActivity("imported", "tool", tool.id, ctx.triggeredBy, name);
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
