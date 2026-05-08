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
import { logActivity } from "@/lib/activity";
import type { ImporterDefinition, ImportRowResult } from "../types";

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
    const results: ImportRowResult[] = [];
    let imported = 0;
    let updated = 0;
    let skipped = 0;
    let failed = 0;
    const upsert = ctx.mode === "upsert";

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
        failed++;
        results.push({ row: rowNumber, status: "failed", message: "Missing projectName" });
        continue;
      }
      if (!toolNameRaw) {
        failed++;
        results.push({ row: rowNumber, status: "failed", message: "Missing toolName" });
        continue;
      }

      const project = projectByName.get(projectNameRaw.toLowerCase());
      if (!project) {
        failed++;
        results.push({ row: rowNumber, status: "failed", message: `Project not found: "${projectNameRaw}"` });
        continue;
      }
      const toolId = toolByName.get(toolNameRaw.toLowerCase());
      if (!toolId) {
        failed++;
        results.push({ row: rowNumber, status: "failed", message: `Tool not found: "${toolNameRaw}"` });
        continue;
      }

      const key = projectToolMatchKey(project.id, toolId);
      if (seenInBatch.has(key)) {
        if (upsert) {
          // No editable fields → DB no-op, but report as updated so
          // admins re-running the same file see a stable count.
          updated++;
          results.push({ row: rowNumber, status: "updated" });
        } else {
          skipped++;
          results.push({
            row: rowNumber,
            status: "skipped",
            message: `Duplicate row in file: "${toolNameRaw}" → "${projectNameRaw}"`,
          });
        }
        continue;
      }
      seenInBatch.add(key);

      const existing = existingByKey.get(key);

      try {
        if (existing && upsert) {
          // Pure link, nothing to mutate — count it as updated for
          // consistency with the rest of the upsert importers.
          updated++;
          results.push({ row: rowNumber, status: "updated" });
        } else if (existing && !upsert) {
          skipped++;
          results.push({
            row: rowNumber,
            status: "skipped",
            message: `Tool "${toolNameRaw}" already linked to "${projectNameRaw}". Re-run with "Update existing rows" enabled to refresh it.`,
          });
        } else {
          const link = await db.projectTool.create({
            data: { projectId: project.id, toolId },
          });
          existingByKey.set(key, { id: link.id });
          imported++;
          results.push({ row: rowNumber, status: "imported" });
          await logActivity("imported", "projectTool", link.id, ctx.triggeredBy, `${toolNameRaw} → ${projectNameRaw}`, {
            projectId: project.id,
            clientId: project.clientId,
          });
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
