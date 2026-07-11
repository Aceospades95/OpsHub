/**
 * Suppliers importer — bulk-create supplier records from CSV.
 *
 * Required: name, category
 * Optional: contactName, contactEmail, contactPhone, address, website,
 *           notes, status, isPreferred
 */

import type { SupplierStatus } from "@prisma/client";
import { normalizeSupplierCategory } from "@/lib/supplier-categories";
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

const VALID_STATUSES: SupplierStatus[] = ["ACTIVE", "INACTIVE", "ARCHIVED"];

function parseBool(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined || value === "") return defaultValue;
  const v = value.trim().toLowerCase();
  if (["false", "no", "0", "off"].includes(v)) return false;
  if (["true", "yes", "1", "on"].includes(v)) return true;
  return defaultValue;
}

export const suppliersImporter: ImporterDefinition = {
  key: "suppliers",
  name: "Suppliers",
  description:
    "Bulk-create or update supplier records. Required: name, category. Optional: contact info, status, preferred flag.",
  module: "suppliers",
  supportsUpsert: true,
  upsertKeyDescription:
    "Matched by supplier name (case-insensitive). Re-uploading the same name updates the existing row.",

  fields: [
    { key: "name", label: "Supplier name", required: true, aliases: ["vendor", "company name", "supplier"] },
    { key: "category", label: "Category", required: true, aliases: ["type", "vendor type", "supplier type"] },
    { key: "status", label: "Status", required: false, description: "ACTIVE, INACTIVE, ARCHIVED. Defaults to ACTIVE.", aliases: ["supplier status"] },
    { key: "contactName", label: "Contact name", required: false, aliases: ["contact", "primary contact", "rep"] },
    { key: "contactTitle", label: "Contact title", required: false, aliases: ["title", "contact job title"] },
    { key: "contactEmail", label: "Contact email", required: false, aliases: ["email", "contact email address"] },
    { key: "contactPhone", label: "Contact phone", required: false, aliases: ["phone", "telephone"] },
    { key: "location", label: "Location", required: false, description: "Short city/region label used for grouping.", aliases: ["city", "region", "area"] },
    { key: "address", label: "Address", required: false, aliases: ["street address", "mailing address"] },
    { key: "website", label: "Website", required: false, aliases: ["url", "site"] },
    { key: "notes", label: "Notes", required: false, aliases: ["description", "comments"] },
    { key: "isPreferred", label: "Preferred supplier", required: false, description: "true/false. Defaults to false.", aliases: ["preferred", "is preferred"] },
  ],

  async sampleRows() {
    const suppliers = await db.supplier.findMany({
      orderBy: { createdAt: "desc" },
      take: 3,
    });
    return suppliers.map((s) => ({
      name: s.name,
      category: s.category,
      status: s.status,
      contactName: s.contactName || "",
      contactTitle: s.contactTitle || "",
      contactEmail: s.contactEmail || "",
      contactPhone: s.contactPhone || "",
      location: s.location || "",
      address: s.address || "",
      website: s.website || "",
      notes: s.notes || "",
      isPreferred: s.isPreferred ? "true" : "false",
    }));
  },

  async exportRows() {
    const suppliers = await db.supplier.findMany({ orderBy: { name: "asc" } });
    return suppliers.map((s) => ({
      name: s.name,
      category: s.category,
      status: s.status,
      contactName: s.contactName || "",
      contactTitle: s.contactTitle || "",
      contactEmail: s.contactEmail || "",
      contactPhone: s.contactPhone || "",
      location: s.location || "",
      address: s.address || "",
      website: s.website || "",
      notes: s.notes || "",
      isPreferred: s.isPreferred ? "true" : "false",
    }));
  },

  async commit(rows, ctx) {
    const db = ctx.db; // ALL commit reads/writes go through ctx.db
    const results: ImportRowResult[] = [];

    // Match by lowercased supplier name. Used for both dedupe and the
    // update path.
    const byName = new Map(
      (await db.supplier.findMany({ select: { id: true, name: true } }))
        .map((s) => [s.name.toLowerCase(), s.id])
    );

    for (let i = 0; i < rows.length; i++) {
      const rowNumber = i + 1;
      const raw = rows[i];
      const warnings: string[] = [];
      const name = (raw.name || "").trim();
      // Same normalization as the create/update forms — a CSV "Fleet
      // Maintenance" must merge with the picker's "fleet_maintenance".
      const category = normalizeSupplierCategory(raw.category || "");

      if (!name) { results.push({ row: rowNumber, status: "failed", message: "Missing name" }); continue; }
      if (!category) { results.push({ row: rowNumber, status: "failed", message: "Missing category" }); continue; }

      const statusRaw = (raw.status || "ACTIVE").trim().toUpperCase();
      const status = VALID_STATUSES.includes(statusRaw as SupplierStatus) ? (statusRaw as SupplierStatus) : null;
      if (!status) { results.push({ row: rowNumber, status: "failed", message: `Invalid status "${raw.status}"` }); continue; }

      const data = {
        name,
        category,
        status,
        contactName: raw.contactName?.trim() || null,
        contactTitle: raw.contactTitle?.trim() || null,
        contactEmail: raw.contactEmail?.trim() || null,
        contactPhone: raw.contactPhone?.trim() || null,
        location: raw.location?.trim() || null,
        address: raw.address?.trim() || null,
        website: raw.website?.trim() || null,
        notes: raw.notes?.trim() || null,
        isPreferred: parseBool(raw.isPreferred, false),
      };

      const existingId = byName.get(name.toLowerCase()) || null;
      const action = applyMode(existingId, ctx.mode);

      try {
        if (action === "update" && existingId) {
          let updateData: Partial<typeof data> = data;
          if (ctx.mode === "fill-blanks") {
            const current = await db.supplier.findUnique({ where: { id: existingId } });
            updateData = mergeFillBlanks(current, data);
          }
          const supplier = await db.supplier.update({ where: { id: existingId }, data: updateData });
          results.push({ row: rowNumber, status: "updated", warnings: warnList(warnings) });
          await logImportActivity(ctx, "imported", "supplier", supplier.id, `${name} (updated)`);
        } else if (action === "skip") {
          results.push({
            row: rowNumber,
            status: "skipped",
            message: existingId
              ? skipExistsMessage(`Supplier "${name}"`)
              : skipNoMatchMessage(`Supplier "${name}"`),
          });
        } else {
          const supplier = await db.supplier.create({ data });
          byName.set(name.toLowerCase(), supplier.id);
          results.push({ row: rowNumber, status: "imported", warnings: warnList(warnings) });
          await logImportActivity(ctx, "imported", "supplier", supplier.id, name);
        }
      } catch (err) {
        results.push({ row: rowNumber, status: "failed", message: err instanceof Error ? err.message : "DB error" });
      }
    }

    return buildResult(results);
  },
};
