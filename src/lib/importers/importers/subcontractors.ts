/**
 * Subcontractors importer — bulk-create / update subcontractor records
 * from CSV.
 *
 * Required: name
 * Optional: type, status, primaryContactName, primaryContactEmail,
 *           primaryContactPhone, website, specialties, complianceStatus,
 *           defaultRate, rateUnit, isPreferred
 *
 * Round-tripping: download → edit → re-upload with the upsert toggle
 * matches existing rows by case-insensitive name.
 */

import type { SubcontractorType, SubcontractorStatus, ComplianceStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { logActivity } from "@/lib/activity";
import type { ImporterDefinition, ImportRowResult } from "../types";

const VALID_TYPES: SubcontractorType[] = ["COMPANY", "INDIVIDUAL", "AGENCY"];
const VALID_STATUSES: SubcontractorStatus[] = ["ACTIVE", "INACTIVE", "ARCHIVED"];
const VALID_COMPLIANCE: ComplianceStatus[] = ["COMPLIANT", "PENDING", "EXPIRED", "NON_COMPLIANT"];

function parseBool(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined || value === "") return defaultValue;
  const v = value.trim().toLowerCase();
  if (["false", "no", "0", "off"].includes(v)) return false;
  if (["true", "yes", "1", "on"].includes(v)) return true;
  return defaultValue;
}

function parseFloatOrNull(value: string | undefined): number | null {
  if (!value || value.trim() === "") return null;
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : null;
}

export const subcontractorsImporter: ImporterDefinition = {
  key: "subcontractors",
  name: "Subcontractors",
  description:
    "Bulk-create or update subcontractor records. Required: name. Optional: type, status, primary contact, specialties, compliance status, rate.",
  module: "subcontractors",
  supportsUpsert: true,
  upsertKeyDescription:
    "Matched by subcontractor name (case-insensitive). Re-uploading the same name updates the existing row.",

  fields: [
    { key: "name", label: "Subcontractor name", required: true, aliases: ["company", "vendor"] },
    { key: "type", label: "Type", required: false, description: "COMPANY, INDIVIDUAL, AGENCY. Defaults to COMPANY.", aliases: ["sub type"] },
    { key: "status", label: "Status", required: false, description: "ACTIVE, INACTIVE, ARCHIVED. Defaults to ACTIVE." },
    { key: "primaryContactName", label: "Primary contact name", required: false, aliases: ["contact", "contact name"] },
    { key: "primaryContactEmail", label: "Primary contact email", required: false, aliases: ["email"] },
    { key: "primaryContactPhone", label: "Primary contact phone", required: false, aliases: ["phone"] },
    { key: "website", label: "Website", required: false, aliases: ["url"] },
    { key: "specialties", label: "Specialties", required: false, description: "Pipe-separated tags (e.g. \"AWS|Terraform|Kubernetes\").", aliases: ["skills", "tags"] },
    { key: "complianceStatus", label: "Compliance status", required: false, description: "COMPLIANT, PENDING, EXPIRED, NON_COMPLIANT. Defaults to PENDING." },
    { key: "defaultRate", label: "Default rate", required: false, aliases: ["rate"] },
    { key: "rateUnit", label: "Rate unit", required: false, description: "hour, day, project, fixed.", aliases: ["unit"] },
    { key: "isPreferred", label: "Preferred", required: false, description: "true/false. Defaults to false." },
  ],

  async exportRows() {
    const subs = await db.subcontractor.findMany({
      where: { deletedAt: null },
      orderBy: { name: "asc" },
    });
    return subs.map((s) => ({
      name: s.name,
      type: s.type,
      status: s.status,
      primaryContactName: s.primaryContactName || "",
      primaryContactEmail: s.primaryContactEmail || "",
      primaryContactPhone: s.primaryContactPhone || "",
      website: s.website || "",
      specialties: s.specialties.join("|"),
      complianceStatus: s.complianceStatus,
      defaultRate: s.defaultRate != null ? String(s.defaultRate) : "",
      rateUnit: s.rateUnit || "",
      isPreferred: s.isPreferred ? "true" : "false",
    }));
  },

  async commit(rows, ctx) {
    const results: ImportRowResult[] = [];
    let imported = 0, updated = 0, skipped = 0, failed = 0;
    const upsert = ctx.mode === "upsert";

    const byName = new Map(
      (await db.subcontractor.findMany({ where: { deletedAt: null }, select: { id: true, name: true } }))
        .map((s) => [s.name.toLowerCase(), s.id])
    );

    for (let i = 0; i < rows.length; i++) {
      const rowNumber = i + 1;
      const raw = rows[i];
      const name = (raw.name || "").trim();
      if (!name) {
        failed++;
        results.push({ row: rowNumber, status: "failed", message: "Missing name" });
        continue;
      }

      const typeRaw = (raw.type || "COMPANY").trim().toUpperCase();
      const type = VALID_TYPES.includes(typeRaw as SubcontractorType)
        ? (typeRaw as SubcontractorType)
        : "COMPANY";
      const statusRaw = (raw.status || "ACTIVE").trim().toUpperCase();
      const status = VALID_STATUSES.includes(statusRaw as SubcontractorStatus)
        ? (statusRaw as SubcontractorStatus)
        : "ACTIVE";
      const complianceRaw = (raw.complianceStatus || "PENDING").trim().toUpperCase();
      const complianceStatus = VALID_COMPLIANCE.includes(complianceRaw as ComplianceStatus)
        ? (complianceRaw as ComplianceStatus)
        : "PENDING";

      const data = {
        name,
        type,
        status,
        primaryContactName: raw.primaryContactName?.trim() || null,
        primaryContactEmail: raw.primaryContactEmail?.trim() || null,
        primaryContactPhone: raw.primaryContactPhone?.trim() || null,
        website: raw.website?.trim() || null,
        specialties: raw.specialties
          ? raw.specialties.split("|").map((t) => t.trim()).filter(Boolean)
          : [],
        complianceStatus,
        defaultRate: parseFloatOrNull(raw.defaultRate),
        rateUnit: raw.rateUnit?.trim() || null,
        isPreferred: parseBool(raw.isPreferred, false),
      };

      const existingId = byName.get(name.toLowerCase()) || null;

      try {
        if (existingId && upsert) {
          const sub = await db.subcontractor.update({ where: { id: existingId }, data });
          updated++;
          results.push({ row: rowNumber, status: "updated" });
          await logActivity("imported", "subcontractor", sub.id, ctx.triggeredBy, `${name} (updated)`);
        } else if (existingId && !upsert) {
          skipped++;
          results.push({
            row: rowNumber,
            status: "skipped",
            message: `Subcontractor already exists: "${name}". Re-run with "Update existing rows" enabled to update it.`,
          });
        } else {
          const sub = await db.subcontractor.create({ data });
          byName.set(name.toLowerCase(), sub.id);
          imported++;
          results.push({ row: rowNumber, status: "imported" });
          await logActivity("imported", "subcontractor", sub.id, ctx.triggeredBy, name);
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
