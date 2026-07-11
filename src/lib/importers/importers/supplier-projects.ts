/**
 * Supplier-projects importer — bulk-link suppliers to projects.
 *
 * Required: supplierName, projectName
 * Optional: notes
 *
 * Note: The Project ↔ SupplierProject relation is currently one-sided in
 * the schema (SupplierProject stores projectId but Project doesn't relate
 * back). The importer creates the join row regardless; supplier detail
 * pages render the link correctly even without the back-reference.
 *
 * Upsert match key: (supplierId + projectId). The notes column is the
 * only mutable field; in upsert mode it's overwritten with the CSV
 * value, in create mode an existing pair is reported as skipped.
 */

import { db } from "@/lib/db";
import type { ImporterDefinition, ImportRowResult } from "../types";
import {
  applyMode,
  buildResult,
  isBlank,
  logImportActivity,
  skipExistsMessage,
  skipNoMatchMessage,
} from "../helpers";

function supplierProjectMatchKey(supplierId: string, projectId: string): string {
  return `${supplierId}|${projectId}`;
}

export const supplierProjectsImporter: ImporterDefinition = {
  key: "supplier-projects",
  name: "Supplier Projects",
  description:
    "Bulk-link suppliers to projects. Both must already exist by name. Required: supplierName, projectName. Optional: notes.",
  module: "suppliers",
  supportsUpsert: true,
  upsertKeyDescription:
    "Matched by (supplier name + project name), case-insensitive. Re-uploading the same pair updates the notes on the existing link in upsert mode; in create mode it reports the row as skipped.",

  fields: [
    { key: "supplierName", label: "Supplier name", required: true, aliases: ["supplier", "vendor"] },
    { key: "projectName", label: "Project name", required: true, aliases: ["project"] },
    { key: "notes", label: "Notes", required: false, aliases: ["comments", "context"] },
  ],

  async sampleRows() {
    const links = await db.supplierProject.findMany({
      orderBy: { createdAt: "desc" },
      take: 3,
      include: { supplier: { select: { name: true } } },
    });
    // Project name needs a separate lookup since SupplierProject has no
    // Project relation back-reference in the schema.
    const projectIds = Array.from(new Set(links.map((l) => l.projectId)));
    const projects = projectIds.length
      ? await db.project.findMany({
          where: { id: { in: projectIds } },
          select: { id: true, name: true },
        })
      : [];
    const projectNameById = new Map(projects.map((p) => [p.id, p.name]));
    return links.map((l) => ({
      supplierName: l.supplier.name,
      projectName: projectNameById.get(l.projectId) || "",
      notes: l.notes || "",
    }));
  },

  async commit(rows, ctx) {
    const db = ctx.db; // ALL commit reads/writes go through ctx.db
    const results: ImportRowResult[] = [];

    const suppliers = await db.supplier.findMany({ select: { id: true, name: true } });
    const supplierByName = new Map(suppliers.map((s) => [s.name.toLowerCase(), s.id]));
    const projects = await db.project.findMany({ select: { id: true, name: true, clientId: true } });
    const projectByName = new Map(projects.map((p) => [p.name.toLowerCase(), p]));

    // Pre-fetch every link keyed by (supplierId + projectId).
    const existingLinks = await db.supplierProject.findMany({
      select: { id: true, supplierId: true, projectId: true },
    });
    const existingByKey = new Map<string, { id: string }>(
      existingLinks.map((l) => [supplierProjectMatchKey(l.supplierId, l.projectId), { id: l.id }])
    );
    const seenInBatch = new Set<string>();

    for (let i = 0; i < rows.length; i++) {
      const rowNumber = i + 1;
      const raw = rows[i];
      const supplierNameRaw = (raw.supplierName || "").trim();
      const projectNameRaw = (raw.projectName || "").trim();

      if (!supplierNameRaw) {
        results.push({ row: rowNumber, status: "failed", message: "Missing supplierName" });
        continue;
      }
      if (!projectNameRaw) {
        results.push({ row: rowNumber, status: "failed", message: "Missing projectName" });
        continue;
      }

      const supplierId = supplierByName.get(supplierNameRaw.toLowerCase());
      if (!supplierId) {
        results.push({ row: rowNumber, status: "failed", message: `Supplier not found: "${supplierNameRaw}"` });
        continue;
      }
      const project = projectByName.get(projectNameRaw.toLowerCase());
      if (!project) {
        results.push({ row: rowNumber, status: "failed", message: `Project not found: "${projectNameRaw}"` });
        continue;
      }

      const key = supplierProjectMatchKey(supplierId, project.id);
      if (seenInBatch.has(key)) {
        results.push({
          row: rowNumber,
          status: "skipped",
          message: `Duplicate row in file: "${supplierNameRaw}" → "${projectNameRaw}"`,
        });
        continue;
      }
      seenInBatch.add(key);

      const data = {
        supplierId,
        projectId: project.id,
        notes: raw.notes?.trim() || null,
      };

      const existing = existingByKey.get(key);
      const action = applyMode(existing, ctx.mode);

      try {
        if (action === "update" && existing) {
          // notes is the only mutable field. In fill-blanks mode only
          // write it when the incoming value is non-empty AND the
          // stored value is empty.
          let notesUpdate: { notes?: string | null } = { notes: data.notes };
          if (ctx.mode === "fill-blanks") {
            const current = await db.supplierProject.findUnique({
              where: { id: existing.id },
              select: { notes: true },
            });
            notesUpdate =
              !isBlank(data.notes) && isBlank(current?.notes)
                ? { notes: data.notes }
                : {};
          }
          const link = await db.supplierProject.update({
            where: { id: existing.id },
            data: notesUpdate,
          });
          results.push({ row: rowNumber, status: "updated" });
          await logImportActivity(
            ctx,
            "imported",
            "supplierProject",
            link.id,
            `${supplierNameRaw} → ${projectNameRaw} (updated)`,
            { projectId: project.id, clientId: project.clientId }
          );
        } else if (action === "skip") {
          const label = `Link "${supplierNameRaw}" → "${projectNameRaw}"`;
          results.push({
            row: rowNumber,
            status: "skipped",
            message: existing ? skipExistsMessage(label) : skipNoMatchMessage(label),
          });
        } else {
          const link = await db.supplierProject.create({ data });
          existingByKey.set(key, { id: link.id });
          results.push({ row: rowNumber, status: "imported" });
          await logImportActivity(
            ctx,
            "imported",
            "supplierProject",
            link.id,
            `${supplierNameRaw} → ${projectNameRaw}`,
            { projectId: project.id, clientId: project.clientId }
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
