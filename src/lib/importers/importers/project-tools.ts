/**
 * Project tools importer — bulk-link existing tools to existing projects.
 * Both sides must already exist (by name). The unique (projectId, toolId)
 * constraint means duplicate rows soft-skip rather than fail.
 *
 * Required: projectName, toolName
 */

import { db } from "@/lib/db";
import { logActivity } from "@/lib/activity";
import type { ImporterDefinition, ImportRowResult } from "../types";

export const projectToolsImporter: ImporterDefinition = {
  key: "project-tools",
  name: "Project Tools",
  description:
    "Bulk-link tools to projects. Both must already exist (by name). Required: projectName, toolName.",
  module: "projects",

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
    let skipped = 0;
    let failed = 0;

    const projects = await db.project.findMany({ select: { id: true, name: true, clientId: true } });
    const projectByName = new Map(projects.map((p) => [p.name.toLowerCase(), p]));
    const tools = await db.tool.findMany({ select: { id: true, name: true } });
    const toolByName = new Map(tools.map((t) => [t.name.toLowerCase(), t.id]));

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

      try {
        const link = await db.projectTool.create({
          data: { projectId: project.id, toolId },
        });
        imported++;
        results.push({ row: rowNumber, status: "imported" });
        await logActivity("imported", "projectTool", link.id, ctx.triggeredBy, `${toolNameRaw} → ${projectNameRaw}`, {
          projectId: project.id,
          clientId: project.clientId,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "DB error";
        if (msg.includes("Unique constraint")) {
          skipped++;
          results.push({
            row: rowNumber,
            status: "skipped",
            message: `Tool "${toolNameRaw}" already linked to "${projectNameRaw}"`,
          });
        } else {
          failed++;
          results.push({ row: rowNumber, status: "failed", message: msg });
        }
      }
    }

    return { imported, skipped, failed, rows: results };
  },
};
