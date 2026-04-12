/**
 * Certifications importer — bulk-create certification records from CSV.
 *
 * Required: name
 * Optional: status, type, issuingBody, certNumber, issuedDate,
 *           expirationDate, renewalDate, renewalLeadDays, autoRenew,
 *           renewalCost, currency, assigneeEmail, clientName
 */

import type { CertificationStatus, CertificationType } from "@prisma/client";
import { db } from "@/lib/db";
import { logActivity } from "@/lib/activity";
import type { ImporterDefinition, ImportResult, ImportRowResult } from "../types";

const VALID_STATUSES: CertificationStatus[] = [
  "ACTIVE", "EXPIRING_SOON", "EXPIRED", "PENDING", "SUSPENDED", "REVOKED",
];
const VALID_TYPES: CertificationType[] = [
  "INDUSTRY", "COMPLIANCE", "SAFETY", "PROFESSIONAL", "QUALITY", "SECURITY", "ENVIRONMENTAL", "VENDOR", "OTHER",
];

function parseDate(v: string | undefined): Date | null {
  if (!v || v.trim() === "") return null;
  const d = new Date(v.trim());
  return isNaN(d.getTime()) ? null : d;
}

function parseBool(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined || value === "") return defaultValue;
  const v = value.trim().toLowerCase();
  if (["false", "no", "0", "off"].includes(v)) return false;
  if (["true", "yes", "1", "on"].includes(v)) return true;
  return defaultValue;
}

export const certificationsImporter: ImporterDefinition = {
  key: "certifications",
  name: "Certifications",
  description:
    "Bulk-create certification records. Required: name. Optional: status, type, issuingBody, dates, renewal info, assignee, client.",
  module: "certifications",

  fields: [
    { key: "name", label: "Certification name", required: true, aliases: ["cert name", "title"] },
    { key: "status", label: "Status", required: false, description: "ACTIVE, PENDING, EXPIRED, etc. Defaults to PENDING.", aliases: ["cert status"] },
    { key: "type", label: "Type", required: false, description: "INDUSTRY, COMPLIANCE, SAFETY, PROFESSIONAL, QUALITY, SECURITY, ENVIRONMENTAL, VENDOR, OTHER.", aliases: ["cert type", "category"] },
    { key: "issuingBody", label: "Issuing body", required: false, aliases: ["issuer", "issued by", "authority"] },
    { key: "certNumber", label: "Certificate number", required: false, aliases: ["cert number", "cert #", "number"] },
    { key: "issuedDate", label: "Issued date", required: false, aliases: ["issue date", "date issued"] },
    { key: "expirationDate", label: "Expiration date", required: false, aliases: ["expiry", "expires", "expiry date"] },
    { key: "renewalDate", label: "Renewal date", required: false, aliases: ["renewal", "renew by"] },
    { key: "renewalLeadDays", label: "Renewal lead days", required: false, description: "Days before expiry to flag. Defaults to 90.", aliases: ["lead days"] },
    { key: "autoRenew", label: "Auto-renew", required: false, description: "true/false. Defaults to false.", aliases: ["auto renew"] },
    { key: "renewalCost", label: "Renewal cost", required: false, aliases: ["cost", "renewal price"] },
    { key: "currency", label: "Currency", required: false, description: "Defaults to USD.", aliases: ["currency code"] },
    { key: "assigneeEmail", label: "Assignee email", required: false, description: "Email of the person responsible for renewal.", aliases: ["assignee", "owner", "responsible"] },
    { key: "clientName", label: "Client name", required: false, description: "Name of the client this cert belongs to (matched by name).", aliases: ["client", "company"] },
  ],

  async commit(rows, ctx) {
    const results: ImportRowResult[] = [];
    let imported = 0, skipped = 0, failed = 0;

    // Pre-fetch lookups
    const users = await db.user.findMany({ select: { id: true, email: true }, where: { isActive: true } });
    const userByEmail = new Map(users.map((u) => [u.email.toLowerCase(), u.id]));
    const clients = await db.client.findMany({ select: { id: true, name: true } });
    const clientByName = new Map(clients.map((c) => [c.name.toLowerCase(), c.id]));

    for (let i = 0; i < rows.length; i++) {
      const rowNumber = i + 1;
      const raw = rows[i];
      const name = (raw.name || "").trim();

      if (!name) {
        failed++; results.push({ row: rowNumber, status: "failed", message: "Missing name" });
        continue;
      }

      const statusRaw = (raw.status || "PENDING").trim().toUpperCase();
      const status = VALID_STATUSES.includes(statusRaw as CertificationStatus)
        ? (statusRaw as CertificationStatus) : null;
      if (!status) {
        failed++; results.push({ row: rowNumber, status: "failed", message: `Invalid status "${raw.status}"` });
        continue;
      }

      const typeRaw = (raw.type || "OTHER").trim().toUpperCase();
      const type = VALID_TYPES.includes(typeRaw as CertificationType)
        ? (typeRaw as CertificationType) : "OTHER";

      const assigneeEmail = (raw.assigneeEmail || "").trim().toLowerCase();
      const assigneeId = assigneeEmail ? userByEmail.get(assigneeEmail) || null : null;
      const clientName = (raw.clientName || "").trim().toLowerCase();
      const clientId = clientName ? clientByName.get(clientName) || null : null;

      try {
        const cert = await db.certification.create({
          data: {
            name,
            status,
            type,
            issuingBody: raw.issuingBody?.trim() || null,
            certNumber: raw.certNumber?.trim() || null,
            issuedDate: parseDate(raw.issuedDate),
            expirationDate: parseDate(raw.expirationDate),
            renewalDate: parseDate(raw.renewalDate),
            renewalLeadDays: raw.renewalLeadDays ? parseInt(raw.renewalLeadDays, 10) || 90 : 90,
            autoRenew: parseBool(raw.autoRenew, false),
            renewalCost: raw.renewalCost ? parseFloat(raw.renewalCost) || null : null,
            currency: raw.currency?.trim() || "USD",
            assigneeId,
            clientId,
          },
        });
        imported++; results.push({ row: rowNumber, status: "imported" });
        await logActivity("imported", "certification", cert.id, ctx.triggeredBy, name);
      } catch (err) {
        failed++; results.push({ row: rowNumber, status: "failed", message: err instanceof Error ? err.message : "DB error" });
      }
    }

    return { imported, skipped, failed, rows: results };
  },
};
