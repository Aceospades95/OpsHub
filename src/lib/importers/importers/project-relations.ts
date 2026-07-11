/**
 * Project-relations importer — bulk-link project ↔ project relationships
 * from CSV.
 *
 * Required: projectName, relatedProjectName
 *
 * Both sides must already exist by name. Each row is a single directed
 * edge — for a symmetric "A relates to B and B relates to A" view, import
 * two rows with the names swapped. Self-links are rejected.
 *
 * Upsert match key: (projectId + relatedProjectId). Pure link with no
 * editable fields, so an upsert is a DB no-op; the importer still
 * honors the toggle to keep counts predictable for admins re-running
 * the same file.
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

function projectRelationMatchKey(projectId: string, relatedProjectId: string): string {
  return `${projectId}|${relatedProjectId}`;
}

export const projectRelationsImporter: ImporterDefinition = {
  key: "project-relations",
  name: "Project Relations",
  description:
    "Bulk-link related projects. Required: projectName, relatedProjectName. Each row is a directed edge — for a symmetric link, import two rows.",
  module: "projects",
  supportsUpsert: true,
  upsertKeyDescription:
    "Matched by (project + relatedProject), case-insensitive. The link has no other editable fields, so upsert mode treats existing pairs as updated no-ops; in create mode they're reported as skipped.",

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
    const db = ctx.db; // ALL commit reads/writes go through ctx.db
    const results: ImportRowResult[] = [];

    const projects = await db.project.findMany({ select: { id: true, name: true, clientId: true } });
    const projectByName = new Map(projects.map((p) => [p.name.toLowerCase(), p]));

    // Pre-fetch every relation keyed by (projectId + relatedProjectId).
    const existingRelations = await db.projectRelation.findMany({
      select: { id: true, projectId: true, relatedProjectId: true },
    });
    const existingByKey = new Map<string, { id: string }>(
      existingRelations.map((r) => [
        projectRelationMatchKey(r.projectId, r.relatedProjectId),
        { id: r.id },
      ])
    );
    const seenInBatch = new Set<string>();

    for (let i = 0; i < rows.length; i++) {
      const rowNumber = i + 1;
      const raw = rows[i];
      const left = (raw.projectName || "").trim();
      const right = (raw.relatedProjectName || "").trim();

      if (!left) {
        results.push({ row: rowNumber, status: "failed", message: "Missing projectName" });
        continue;
      }
      if (!right) {
        results.push({ row: rowNumber, status: "failed", message: "Missing relatedProjectName" });
        continue;
      }

      const leftProject = projectByName.get(left.toLowerCase());
      const rightProject = projectByName.get(right.toLowerCase());
      if (!leftProject) {
        results.push({ row: rowNumber, status: "failed", message: `Project not found: "${left}"` });
        continue;
      }
      if (!rightProject) {
        results.push({ row: rowNumber, status: "failed", message: `Project not found: "${right}"` });
        continue;
      }
      if (leftProject.id === rightProject.id) {
        results.push({
          row: rowNumber,
          status: "failed",
          message: "Cannot relate a project to itself",
        });
        continue;
      }

      const key = projectRelationMatchKey(leftProject.id, rightProject.id);
      if (seenInBatch.has(key)) {
        results.push({
          row: rowNumber,
          status: "skipped",
          message: `Duplicate row in file: "${left}" → "${right}"`,
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
          const label = `Relation "${left} → ${right}"`;
          results.push({
            row: rowNumber,
            status: "skipped",
            message: existing ? skipExistsMessage(label) : skipNoMatchMessage(label),
          });
        } else {
          const rel = await db.projectRelation.create({
            data: { projectId: leftProject.id, relatedProjectId: rightProject.id },
          });
          existingByKey.set(key, { id: rel.id });
          results.push({ row: rowNumber, status: "imported" });
          await logImportActivity(
            ctx,
            "imported",
            "projectRelation",
            rel.id,
            `${left} ↔ ${right}`,
            { projectId: leftProject.id, clientId: leftProject.clientId }
          );
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
