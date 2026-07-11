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
    const db = ctx.db; // ALL commit reads/writes go through ctx.db
    const results: ImportRowResult[] = [];

    const byName = new Map(
      (await db.subcontractor.findMany({ where: { deletedAt: null }, select: { id: true, name: true } }))
        .map((s) => [s.name.toLowerCase(), s.id])
    );

    for (let i = 0; i < rows.length; i++) {
      const rowNumber = i + 1;
      const raw = rows[i];
      const warnings: string[] = [];
      const name = (raw.name || "").trim();
      if (!name) {
        results.push({ row: rowNumber, status: "failed", message: "Missing name" });
        continue;
      }

      const typeInput = (raw.type || "").trim();
      const typeRaw = (typeInput || "COMPANY").toUpperCase();
      const type = VALID_TYPES.includes(typeRaw as SubcontractorType)
        ? (typeRaw as SubcontractorType)
        : "COMPANY";
      if (typeInput && !VALID_TYPES.includes(typeRaw as SubcontractorType)) {
        warnings.push(`Invalid type "${typeInput}" — defaulted to COMPANY`);
      }
      const statusInput = (raw.status || "").trim();
      const statusRaw = (statusInput || "ACTIVE").toUpperCase();
      const status = VALID_STATUSES.includes(statusRaw as SubcontractorStatus)
        ? (statusRaw as SubcontractorStatus)
        : "ACTIVE";
      if (statusInput && !VALID_STATUSES.includes(statusRaw as SubcontractorStatus)) {
        warnings.push(`Invalid status "${statusInput}" — defaulted to ACTIVE`);
      }
      const complianceInput = (raw.complianceStatus || "").trim();
      const complianceRaw = (complianceInput || "PENDING").toUpperCase();
      const complianceStatus = VALID_COMPLIANCE.includes(complianceRaw as ComplianceStatus)
        ? (complianceRaw as ComplianceStatus)
        : "PENDING";
      if (complianceInput && !VALID_COMPLIANCE.includes(complianceRaw as ComplianceStatus)) {
        warnings.push(`Invalid compliance status "${complianceInput}" — defaulted to PENDING`);
      }

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
      const action = applyMode(existingId, ctx.mode);

      try {
        if (action === "update" && existingId) {
          let updateData: Partial<typeof data> = data;
          if (ctx.mode === "fill-blanks") {
            const current = await db.subcontractor.findUnique({ where: { id: existingId } });
            updateData = mergeFillBlanks(current, data);
          }
          const sub = await db.subcontractor.update({ where: { id: existingId }, data: updateData });
          results.push({ row: rowNumber, status: "updated", warnings: warnList(warnings) });
          await logImportActivity(ctx, "imported", "subcontractor", sub.id, `${name} (updated)`);
        } else if (action === "skip") {
          results.push({
            row: rowNumber,
            status: "skipped",
            message: existingId
              ? skipExistsMessage(`Subcontractor "${name}"`)
              : skipNoMatchMessage(`Subcontractor "${name}"`),
          });
        } else {
          const sub = await db.subcontractor.create({ data });
          byName.set(name.toLowerCase(), sub.id);
          results.push({ row: rowNumber, status: "imported", warnings: warnList(warnings) });
          await logImportActivity(ctx, "imported", "subcontractor", sub.id, name);
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
