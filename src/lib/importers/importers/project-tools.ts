/**
 * Project tools importer — bulk-link existing tools to existing projects.
 * Both sides must already exist (by name).
 *
 * Required: projectName, toolName
 *
 * This is a pure link table: there are no editable fields beyond the
 * pair itself, so an upsert is effectively a no-op in the DB. The
 * importer still honors the upsert toggle so admins re-running the same
 * file see consistent counts (existing-pair → updated in upsert mode,
 * skipped in create mode).
 */

import { db } from "@/lib/db";
import type { ImporterDefinition, ImportRowResult } from "../types";
import {
  applyMode,
  buildResult,
  logImportActivity,
  skipExistsMessage,
  skipNoMatchMessage,
} from "../helpers";

function projectToolMatchKey(projectId: string, toolId: string): string {
  return `${projectId}|${toolId}`;
}

export const projectToolsImporter: ImporterDefinition = {
  key: "project-tools",
  name: "Project Tools",
  description:
    "Bulk-link tools to projects. Both must already exist (by name). Required: projectName, toolName.",
  module: "projects",
  supportsUpsert: true,
  upsertKeyDescription:
    "Matched by (project + tool), case-insensitive on both. The link has no other editable fields, so upsert mode treats existing pairs as updated no-ops; in create mode they're reported as skipped.",

  fields: [
    { key: "projectName", label: "Project name", required: true, description: "Must match an existing project by name.", aliases: ["project"] },
    { key: "toolName", label: "Tool name", required: true, description: "Must match an existing tool by name.", aliases: ["tool"] },
  ],

  async sampleRows() {
    const links = await db.projectTool.findMany({
      orderBy: { createdAt: "desc" },
      take: 3,
      include: {
        project: { select: { name: true } },
        tool: { select: { name: true } },
      },
    });
    return links.map((l) => ({
      projectName: l.project.name,
      toolName: l.tool.name,
    }));
  },

  async commit(rows, ctx) {
    const db = ctx.db; // ALL commit reads/writes go through ctx.db
    const results: ImportRowResult[] = [];

    const projects = await db.project.findMany({ select: { id: true, name: true, clientId: true } });
    const projectByName = new Map(projects.map((p) => [p.name.toLowerCase(), p]));
    const tools = await db.tool.findMany({ select: { id: true, name: true } });
    const toolByName = new Map(tools.map((t) => [t.name.toLowerCase(), t.id]));

    // Pre-fetch every link keyed by (projectId + toolId).
    const existingLinks = await db.projectTool.findMany({
      select: { id: true, projectId: true, toolId: true },
    });
    const existingByKey = new Map<string, { id: string }>(
      existingLinks.map((l) => [projectToolMatchKey(l.projectId, l.toolId), { id: l.id }])
    );
    const seenInBatch = new Set<string>();

    for (let i = 0; i < rows.length; i++) {
      const rowNumber = i + 1;
      const raw = rows[i];
      const projectNameRaw = (raw.projectName || "").trim();
      const toolNameRaw = (raw.toolName || "").trim();

      if (!projectNameRaw) {
        results.push({ row: rowNumber, status: "failed", message: "Missing projectName" });
        continue;
      }
      if (!toolNameRaw) {
        results.push({ row: rowNumber, status: "failed", message: "Missing toolName" });
        continue;
      }

      const project = projectByName.get(projectNameRaw.toLowerCase());
      if (!project) {
        results.push({ row: rowNumber, status: "failed", message: `Project not found: "${projectNameRaw}"` });
        continue;
      }
      const toolId = toolByName.get(toolNameRaw.toLowerCase());
      if (!toolId) {
        results.push({ row: rowNumber, status: "failed", message: `Tool not found: "${toolNameRaw}"` });
        continue;
      }

      const key = projectToolMatchKey(project.id, toolId);
      if (seenInBatch.has(key)) {
        results.push({
          row: rowNumber,
          status: "skipped",
          message: `Duplicate row in file: "${toolNameRaw}" → "${projectNameRaw}"`,
        });
        continue;
      }
      seenInBatch.add(key);

      const existing = existingByKey.get(key);
      const action = applyMode(existing, ctx.mode);

      try {
        if (action === "update" && existing) {
          // Pure link, nothing to mutate — count it as updated (no-op)
          // for consistency with the rest of the mode-aware importers.
          results.push({ row: rowNumber, status: "updated" });
        } else if (action === "skip") {
          const label = `Link "${toolNameRaw}" → "${projectNameRaw}"`;
          results.push({
            row: rowNumber,
            status: "skipped",
            message: existing ? skipExistsMessage(label) : skipNoMatchMessage(label),
          });
        } else {
          const link = await db.projectTool.create({
            data: { projectId: project.id, toolId },
          });
          existingByKey.set(key, { id: link.id });
          results.push({ row: rowNumber, status: "imported" });
          await logImportActivity(ctx, "imported", "projectTool", link.id, `${toolNameRaw} → ${projectNameRaw}`, {
            projectId: project.id,
            clientId: project.clientId,
          });
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
