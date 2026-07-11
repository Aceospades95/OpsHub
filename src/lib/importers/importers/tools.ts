/**
 * Tools importer — bulk-create or update internal/external tool entries
 * from CSV.
 *
 * Required: name
 * Optional: description, category, toolUrl, toolType, isGlobal
 *
 * Upsert match key: lowercased name. Re-uploading the same CSV updates
 * existing rows in upsert mode and skips them in create mode.
 */

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
    "Bulk-create or update tool entries. Required: name. Optional: description, category, URL, tool type, global flag.",
  module: "tools",
  supportsUpsert: true,
  upsertKeyDescription:
    "Matched by tool name (case-insensitive). Re-uploading the same name updates the existing row instead of creating a duplicate.",

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

  async exportRows() {
    const tools = await db.tool.findMany({ orderBy: { name: "asc" } });
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
    const db = ctx.db; // ALL commit reads/writes go through ctx.db
    const results: ImportRowResult[] = [];

    // Pre-fetch every tool keyed by lowercased name. Used for both
    // dedupe and the update path.
    const existingByKey = new Map(
      (await db.tool.findMany({ select: { id: true, name: true } }))
        .map((t) => [t.name.toLowerCase(), { id: t.id }])
    );
    const seenInBatch = new Set<string>();

    for (let i = 0; i < rows.length; i++) {
      const rowNumber = i + 1;
      const raw = rows[i];
      const warnings: string[] = [];
      const name = (raw.name || "").trim();
      if (!name) {
        results.push({ row: rowNumber, status: "failed", message: "Missing name" });
        continue;
      }

      const toolTypeInput = (raw.toolType || "").trim();
      const toolTypeRaw = (toolTypeInput || "internal").toLowerCase();
      const toolType: ToolType = (VALID_TYPES as readonly string[]).includes(toolTypeRaw)
        ? (toolTypeRaw as ToolType)
        : "internal";
      if (toolTypeInput && !(VALID_TYPES as readonly string[]).includes(toolTypeRaw)) {
        warnings.push(`Invalid tool type "${toolTypeInput}" — defaulted to internal`);
      }

      const key = name.toLowerCase();
      if (seenInBatch.has(key)) {
        results.push({
          row: rowNumber,
          status: "skipped",
          message: `Duplicate row in file: "${name}"`,
        });
        continue;
      }
      seenInBatch.add(key);

      const data = {
        name,
        description: raw.description?.trim() || null,
        category: raw.category?.trim() || null,
        toolUrl: raw.toolUrl?.trim() || null,
        toolType,
        isGlobal: parseBool(raw.isGlobal, true),
      };

      const existing = existingByKey.get(key);
      const action = applyMode(existing, ctx.mode);

      try {
        if (action === "update" && existing) {
          let updateData: Partial<typeof data> = data;
          if (ctx.mode === "fill-blanks") {
            const current = await db.tool.findUnique({ where: { id: existing.id } });
            updateData = mergeFillBlanks(current, data);
          }
          const tool = await db.tool.update({ where: { id: existing.id }, data: updateData });
          results.push({ row: rowNumber, status: "updated", warnings: warnList(warnings) });
          await logImportActivity(ctx, "imported", "tool", tool.id, `${name} (updated)`);
        } else if (action === "skip") {
          results.push({
            row: rowNumber,
            status: "skipped",
            message: existing
              ? skipExistsMessage(`Tool "${name}"`)
              : skipNoMatchMessage(`Tool "${name}"`),
          });
        } else {
          const tool = await db.tool.create({ data });
          existingByKey.set(key, { id: tool.id });
          results.push({ row: rowNumber, status: "imported", warnings: warnList(warnings) });
          await logImportActivity(ctx, "imported", "tool", tool.id, name);
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
