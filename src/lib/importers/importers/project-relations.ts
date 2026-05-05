/**
 * Project-relations importer — bulk-link project ↔ project relationships
 * from CSV.
 *
 * Required: projectName, relatedProjectName
 *
 * Both sides must already exist by name. The (projectId, relatedProjectId)
 * pair is unique; duplicate rows soft-skip rather than fail. Self-links
 * (a project related to itself) are rejected.
 *
 * The schema models a single directed edge per row. If you want a
 * symmetric "A relates to B and B relates to A" view, import two rows
 * with the names swapped.
 */

import { db } from "@/lib/db";
import { logActivity } from "@/lib/activity";
import type { ImporterDefinition, ImportRowResult } from "../types";

export const projectRelationsImporter: ImporterDefinition = {
  key: "project-relations",
  name: "Project Relations",
  description:
    "Bulk-link related projects. Required: projectName, relatedProjectName. Each row is a directed edge — for a symmetric link, import two rows.",
  module: "projects",

  fields: [
    { key: "projectName", label: "Project name", required: true, aliases: ["project"] },
    {
      key: "relatedProjectName",
      label: "Related project name",
      required: true,
      description: "Must match an existing project by name.",
      aliases: ["related project", "links to"],
    },
  ],

  async sampleRows() {
    const links = await db.projectRelation.findMany({
      orderBy: { createdAt: "desc" },
      take: 3,
      include: {
        project: { select: { name: true } },
        relatedProject: { select: { name: true } },
      },
    });
    return links.map((l) => ({
      projectName: l.project.name,
      relatedProjectName: l.relatedProject.name,
    }));
  },

  async commit(rows, ctx) {
    const results: ImportRowResult[] = [];
    let imported = 0;
    let skipped = 0;
    let failed = 0;

    const projects = await db.project.findMany({ select: { id: true, name: true, clientId: true } });
    const projectByName = new Map(projects.map((p) => [p.name.toLowerCase(), p]));

    for (let i = 0; i < rows.length; i++) {
      const rowNumber = i + 1;
      const raw = rows[i];
      const left = (raw.projectName || "").trim();
      const right = (raw.relatedProjectName || "").trim();

      if (!left) {
        failed++;
        results.push({ row: rowNumber, status: "failed", message: "Missing projectName" });
        continue;
      }
      if (!right) {
        failed++;
        results.push({ row: rowNumber, status: "failed", message: "Missing relatedProjectName" });
        continue;
      }

      const leftProject = projectByName.get(left.toLowerCase());
      const rightProject = projectByName.get(right.toLowerCase());
      if (!leftProject) {
        failed++;
        results.push({ row: rowNumber, status: "failed", message: `Project not found: "${left}"` });
        continue;
      }
      if (!rightProject) {
        failed++;
        results.push({ row: rowNumber, status: "failed", message: `Project not found: "${right}"` });
        continue;
      }
      if (leftProject.id === rightProject.id) {
        failed++;
        results.push({
          row: rowNumber,
          status: "failed",
          message: "Cannot relate a project to itself",
        });
        continue;
      }

      try {
        const rel = await db.projectRelation.create({
          data: { projectId: leftProject.id, relatedProjectId: rightProject.id },
        });
        imported++;
        results.push({ row: rowNumber, status: "imported" });
        await logActivity(
          "imported",
          "projectRelation",
          rel.id,
          ctx.triggeredBy,
          `${left} ↔ ${right}`,
          { projectId: leftProject.id, clientId: leftProject.clientId }
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : "DB error";
        if (msg.includes("Unique constraint")) {
          skipped++;
          results.push({
            row: rowNumber,
            status: "skipped",
            message: `Relation "${left} → ${right}" already exists`,
          });
        } else {
          failed++;
          results.push({ row: rowNumber, status: "failed", message: msg });
        }
      }
    }

    return { imported, updated: 0, skipped, failed, rows: results };
  },
};
