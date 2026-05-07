/**
 * Partnerships importer — bulk-create / update partnership records
 * from CSV.
 *
 * Required: name
 * Optional: type, status, tier, industry, primaryContactName,
 *           primaryContactEmail, primaryContactPhone, website, autoRenew,
 *           jointMarketing, agreementSignedAt, agreementExpiresAt
 *
 * Round-tripping: download → edit → re-upload with the upsert toggle
 * matches existing rows by case-insensitive name.
 */

import type { PartnershipType, PartnershipStatus, PartnershipTier } from "@prisma/client";
import { db } from "@/lib/db";
import { logActivity } from "@/lib/activity";
import type { ImporterDefinition, ImportRowResult } from "../types";

const VALID_TYPES: PartnershipType[] = ["TECHNOLOGY", "STRATEGIC", "REFERRAL", "RESELLER", "OTHER"];
const VALID_STATUSES: PartnershipStatus[] = ["ACTIVE", "INACTIVE", "ARCHIVED"];
const VALID_TIERS: PartnershipTier[] = ["PLATINUM", "GOLD", "SILVER", "BRONZE", "STANDARD"];

function parseBool(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined || value === "") return defaultValue;
  const v = value.trim().toLowerCase();
  if (["false", "no", "0", "off"].includes(v)) return false;
  if (["true", "yes", "1", "on"].includes(v)) return true;
  return defaultValue;
}

function parseDateOrNull(value: string | undefined): Date | null {
  if (!value || value.trim() === "") return null;
  const d = new Date(value.trim());
  return isNaN(d.getTime()) ? null : d;
}

function formatDate(d: Date | null | undefined): string {
  return d ? d.toISOString().slice(0, 10) : "";
}

export const partnershipsImporter: ImporterDefinition = {
  key: "partnerships",
  name: "Partnerships",
  description:
    "Bulk-create or update partnership records. Required: name. Optional: type, status, tier, industry, primary contact, agreement dates.",
  module: "partnerships",
  supportsUpsert: true,
  upsertKeyDescription:
    "Matched by partnership name (case-insensitive). Re-uploading the same name updates the existing row.",

  fields: [
    { key: "name", label: "Partnership name", required: true, aliases: ["partner", "company"] },
    { key: "type", label: "Type", required: false, description: "TECHNOLOGY, STRATEGIC, REFERRAL, RESELLER, OTHER. Defaults to STRATEGIC." },
    { key: "status", label: "Status", required: false, description: "ACTIVE, INACTIVE, ARCHIVED. Defaults to ACTIVE." },
    { key: "tier", label: "Tier", required: false, description: "PLATINUM, GOLD, SILVER, BRONZE, STANDARD." },
    { key: "industry", label: "Industry", required: false },
    { key: "primaryContactName", label: "Primary contact name", required: false, aliases: ["contact"] },
    { key: "primaryContactEmail", label: "Primary contact email", required: false, aliases: ["email"] },
    { key: "primaryContactPhone", label: "Primary contact phone", required: false, aliases: ["phone"] },
    { key: "website", label: "Website", required: false, aliases: ["url"] },
    { key: "autoRenew", label: "Auto-renew", required: false, description: "true/false. Defaults to false." },
    { key: "jointMarketing", label: "Joint marketing", required: false, description: "true/false. Defaults to false." },
    { key: "agreementSignedAt", label: "Agreement signed", required: false, description: "ISO date." },
    { key: "agreementExpiresAt", label: "Agreement expires", required: false, description: "ISO date." },
  ],

  async exportRows() {
    const partnerships = await db.partnership.findMany({
      where: { deletedAt: null },
      orderBy: { name: "asc" },
    });
    return partnerships.map((p) => ({
      name: p.name,
      type: p.type,
      status: p.status,
      tier: p.tier || "",
      industry: p.industry || "",
      primaryContactName: p.primaryContactName || "",
      primaryContactEmail: p.primaryContactEmail || "",
      primaryContactPhone: p.primaryContactPhone || "",
      website: p.website || "",
      autoRenew: p.autoRenew ? "true" : "false",
      jointMarketing: p.jointMarketing ? "true" : "false",
      agreementSignedAt: formatDate(p.agreementSignedAt),
      agreementExpiresAt: formatDate(p.agreementExpiresAt),
    }));
  },

  async commit(rows, ctx) {
    const results: ImportRowResult[] = [];
    let imported = 0, updated = 0, skipped = 0, failed = 0;
    const upsert = ctx.mode === "upsert";

    const byName = new Map(
      (await db.partnership.findMany({ where: { deletedAt: null }, select: { id: true, name: true } }))
        .map((p) => [p.name.toLowerCase(), p.id])
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

      const typeRaw = (raw.type || "STRATEGIC").trim().toUpperCase();
      const type = VALID_TYPES.includes(typeRaw as PartnershipType)
        ? (typeRaw as PartnershipType)
        : "STRATEGIC";
      const statusRaw = (raw.status || "ACTIVE").trim().toUpperCase();
      const status = VALID_STATUSES.includes(statusRaw as PartnershipStatus)
        ? (statusRaw as PartnershipStatus)
        : "ACTIVE";
      const tierRaw = (raw.tier || "").trim().toUpperCase();
      const tier = tierRaw && VALID_TIERS.includes(tierRaw as PartnershipTier)
        ? (tierRaw as PartnershipTier)
        : null;

      const data = {
        name,
        type,
        status,
        tier,
        industry: raw.industry?.trim() || null,
        primaryContactName: raw.primaryContactName?.trim() || null,
        primaryContactEmail: raw.primaryContactEmail?.trim() || null,
        primaryContactPhone: raw.primaryContactPhone?.trim() || null,
        website: raw.website?.trim() || null,
        autoRenew: parseBool(raw.autoRenew, false),
        jointMarketing: parseBool(raw.jointMarketing, false),
        agreementSignedAt: parseDateOrNull(raw.agreementSignedAt),
        agreementExpiresAt: parseDateOrNull(raw.agreementExpiresAt),
      };

      const existingId = byName.get(name.toLowerCase()) || null;

      try {
        if (existingId && upsert) {
          const p = await db.partnership.update({ where: { id: existingId }, data });
          updated++;
          results.push({ row: rowNumber, status: "updated" });
          await logActivity("imported", "partnership", p.id, ctx.triggeredBy, `${name} (updated)`);
        } else if (existingId && !upsert) {
          skipped++;
          results.push({
            row: rowNumber,
            status: "skipped",
            message: `Partnership already exists: "${name}". Re-run with "Update existing rows" enabled to update it.`,
          });
        } else {
          const p = await db.partnership.create({ data });
          byName.set(name.toLowerCase(), p.id);
          imported++;
          results.push({ row: rowNumber, status: "imported" });
          await logActivity("imported", "partnership", p.id, ctx.triggeredBy, name);
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
