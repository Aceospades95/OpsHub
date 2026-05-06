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
 */

import { db } from "@/lib/db";
import { logActivity } from "@/lib/activity";
import type { ImporterDefinition, ImportRowResult } from "../types";

export const supplierProjectsImporter: ImporterDefinition = {
  key: "supplier-projects",
  name: "Supplier Projects",
  description:
    "Bulk-link suppliers to projects. Both must already exist by name. Required: supplierName, projectName. Optional: notes.",
  module: "suppliers",

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
    const results: ImportRowResult[] = [];
    let imported = 0;
    let skipped = 0;
    let failed = 0;

    const suppliers = await db.supplier.findMany({ select: { id: true, name: true } });
    const supplierByName = new Map(suppliers.map((s) => [s.name.toLowerCase(), s.id]));
    const projects = await db.project.findMany({ select: { id: true, name: true, clientId: true } });
    const projectByName = new Map(projects.map((p) => [p.name.toLowerCase(), p]));

    for (let i = 0; i < rows.length; i++) {
      const rowNumber = i + 1;
      const raw = rows[i];
      const supplierNameRaw = (raw.supplierName || "").trim();
      const projectNameRaw = (raw.projectName || "").trim();

      if (!supplierNameRaw) {
        failed++;
        results.push({ row: rowNumber, status: "failed", message: "Missing supplierName" });
        continue;
      }
      if (!projectNameRaw) {
        failed++;
        results.push({ row: rowNumber, status: "failed", message: "Missing projectName" });
        continue;
      }

      const supplierId = supplierByName.get(supplierNameRaw.toLowerCase());
      if (!supplierId) {
        failed++;
        results.push({ row: rowNumber, status: "failed", message: `Supplier not found: "${supplierNameRaw}"` });
        continue;
      }
      const project = projectByName.get(projectNameRaw.toLowerCase());
      if (!project) {
        failed++;
        results.push({ row: rowNumber, status: "failed", message: `Project not found: "${projectNameRaw}"` });
        continue;
      }

      try {
        const link = await db.supplierProject.create({
          data: {
            supplierId,
            projectId: project.id,
            notes: raw.notes?.trim() || null,
          },
        });
        imported++;
        results.push({ row: rowNumber, status: "imported" });
        await logActivity(
          "imported",
          "supplierProject",
          link.id,
          ctx.triggeredBy,
          `${supplierNameRaw} → ${projectNameRaw}`,
          { projectId: project.id, clientId: project.clientId }
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : "DB error";
        if (msg.includes("Unique constraint")) {
          skipped++;
          results.push({
            row: rowNumber,
            status: "skipped",
            message: `Supplier "${supplierNameRaw}" already linked to "${projectNameRaw}"`,
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
