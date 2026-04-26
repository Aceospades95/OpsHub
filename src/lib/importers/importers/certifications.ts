/**
 * Certifications importer — bulk-create certification records from CSV.
 *
 * Required: name
 * Optional: most columns on the Certification model, including plain-English
 * summary, agency website & contact info, jurisdiction, engagement type,
 * reminder offsets (pipe- or comma-separated), point of contact, and links
 * to both compiled application materials and the completed certificate.
 */

import type {
  CertificationStatus,
  CertificationType,
  JurisdictionLevel,
  CertEngagementType,
} from "@prisma/client";
import { db } from "@/lib/db";
import { logActivity } from "@/lib/activity";
import type { ImporterDefinition, ImportRowResult } from "../types";

const VALID_STATUSES: CertificationStatus[] = [
  "ACTIVE",
  "EXPIRING_SOON",
  "EXPIRED",
  "PENDING",
  "SUSPENDED",
  "REVOKED",
];
const VALID_TYPES: CertificationType[] = [
  "INDUSTRY",
  "COMPLIANCE",
  "SAFETY",
  "PROFESSIONAL",
  "QUALITY",
  "SECURITY",
  "ENVIRONMENTAL",
  "VENDOR",
  "OTHER",
];
const VALID_JURISDICTIONS: JurisdictionLevel[] = [
  "FEDERAL",
  "STATE",
  "COUNTY",
  "CITY",
  "AGENCY",
  "PRIVATE",
  "OTHER",
];
const VALID_ENGAGEMENT_TYPES: CertEngagementType[] = ["SUBSCRIPTION", "CERTIFICATION"];

function parseDate(v: string | undefined): Date | null {
  if (!v || v.trim() === "") return null;
  const d = new Date(v.trim());
  return isNaN(d.getTime()) ? null : d;
}

function formatDate(d: Date | null | undefined): string {
  return d ? d.toISOString().slice(0, 10) : "";
}

function parseBool(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined || value === "") return defaultValue;
  const v = value.trim().toLowerCase();
  if (["false", "no", "0", "off"].includes(v)) return false;
  if (["true", "yes", "1", "on"].includes(v)) return true;
  return defaultValue;
}

function parseOffsets(value: string | undefined): number[] | null {
  if (!value || !value.trim()) return null;
  const parts = value.split(/[,|]/).map((p) => parseInt(p.trim(), 10));
  const clean = parts.filter((n) => Number.isFinite(n) && n > 0);
  if (clean.length === 0) return null;
  return Array.from(new Set(clean)).sort((a, b) => b - a);
}

export const certificationsImporter: ImporterDefinition = {
  key: "certifications",
  name: "Certifications",
  description:
    "Bulk-create certification records. Required: name. Optional: status, type, jurisdiction, agency info, reminders, assignee, point of contact, and more.",
  module: "certifications",

  fields: [
    { key: "name", label: "Certification name", required: true, aliases: ["cert name", "title"] },
    {
      key: "plainEnglishSummary",
      label: "Plain-English summary",
      required: false,
      description: "Layman explanation of what this cert is.",
      aliases: ["summary", "layman", "plain english"],
    },
    {
      key: "status",
      label: "Status",
      required: false,
      description: "ACTIVE, PENDING, EXPIRED, etc. Defaults to PENDING.",
      aliases: ["cert status"],
    },
    {
      key: "type",
      label: "Type",
      required: false,
      description:
        "INDUSTRY, COMPLIANCE, SAFETY, PROFESSIONAL, QUALITY, SECURITY, ENVIRONMENTAL, VENDOR, OTHER.",
      aliases: ["cert type", "category"],
    },
    {
      key: "engagementType",
      label: "Engagement type",
      required: false,
      description: "CERTIFICATION or SUBSCRIPTION. Defaults to CERTIFICATION.",
      aliases: ["engagement", "cert or sub"],
    },
    {
      key: "jurisdictionLevel",
      label: "Jurisdiction level",
      required: false,
      description:
        "FEDERAL, STATE, COUNTY, CITY, AGENCY, PRIVATE, OTHER. Defaults to OTHER.",
      aliases: ["jurisdiction", "level"],
    },
    {
      key: "jurisdictionName",
      label: "Jurisdiction name",
      required: false,
      description: "Specific jurisdiction, e.g. Illinois or Cook County.",
      aliases: ["state", "city", "jurisdiction detail"],
    },
    { key: "issuingBody", label: "Issuing body", required: false, aliases: ["issuer", "issued by", "authority"] },
    {
      key: "agencyWebsiteUrl",
      label: "Agency website",
      required: false,
      aliases: ["agency url", "agency site", "website"],
    },
    { key: "agencyContactName", label: "Agency contact name", required: false, aliases: ["agency rep"] },
    { key: "agencyContactEmail", label: "Agency contact email", required: false, aliases: ["agency email"] },
    { key: "agencyContactPhone", label: "Agency contact phone", required: false, aliases: ["agency phone"] },
    { key: "certNumber", label: "Certificate number", required: false, aliases: ["cert number", "cert #", "number"] },
    { key: "submittedDate", label: "Submitted date", required: false, aliases: ["application date", "applied"] },
    { key: "issuedDate", label: "Issued date", required: false, aliases: ["issue date", "date issued"] },
    { key: "expirationDate", label: "Expiration date", required: false, aliases: ["expiry", "expires", "expiry date"] },
    { key: "renewalDate", label: "Renewal date", required: false, aliases: ["renewal", "renew by"] },
    {
      key: "renewalLeadDays",
      label: "Renewal lead days",
      required: false,
      description: "Legacy single lead. Defaults to 90 when no reminder offsets given.",
      aliases: ["lead days"],
    },
    {
      key: "reminderOffsetsDays",
      label: "Reminder offsets (days)",
      required: false,
      description:
        "Multi-tier reminders as comma- or pipe-separated day counts (e.g. 90|30|7).",
      aliases: ["reminders", "reminder offsets"],
    },
    { key: "autoRenew", label: "Auto-renew", required: false, description: "true/false. Defaults to false.", aliases: ["auto renew"] },
    { key: "renewalCost", label: "Renewal cost", required: false, aliases: ["cost", "renewal price"] },
    { key: "currency", label: "Currency", required: false, description: "Defaults to USD.", aliases: ["currency code"] },
    {
      key: "documentUrl",
      label: "Compiled documents URL",
      required: false,
      description: "Link to application packet or working folder.",
      aliases: ["application url", "packet url"],
    },
    {
      key: "completedCertUrl",
      label: "Completed certificate URL",
      required: false,
      description: "Link to the finished/issued certificate document.",
      aliases: ["cert doc url", "finished cert"],
    },
    {
      key: "assigneeEmail",
      label: "Assignee email",
      required: false,
      description: "Email of the current owner of the renewal task.",
      aliases: ["assignee", "owner", "responsible"],
    },
    {
      key: "pointOfContactEmail",
      label: "Point of contact email",
      required: false,
      description: "Long-term internal owner for this cert, by email.",
      aliases: ["poc email", "poc", "internal contact"],
    },
    {
      key: "clientName",
      label: "Client name",
      required: false,
      description: "Name of the client this cert belongs to (matched by name).",
      aliases: ["client", "company"],
    },
  ],

  async sampleRows() {
    const certs = await db.certification.findMany({
      orderBy: { createdAt: "desc" },
      take: 3,
      include: {
        assignee: { select: { email: true } },
        pointOfContact: { select: { email: true } },
        client: { select: { name: true } },
      },
    });
    return certs.map((c) => ({
      name: c.name,
      plainEnglishSummary: c.plainEnglishSummary || "",
      status: c.status,
      type: c.type,
      engagementType: c.engagementType,
      jurisdictionLevel: c.jurisdictionLevel,
      jurisdictionName: c.jurisdictionName || "",
      issuingBody: c.issuingBody || "",
      agencyWebsiteUrl: c.agencyWebsiteUrl || "",
      agencyContactName: c.agencyContactName || "",
      agencyContactEmail: c.agencyContactEmail || "",
      agencyContactPhone: c.agencyContactPhone || "",
      certNumber: c.certNumber || "",
      submittedDate: formatDate(c.submittedDate),
      issuedDate: formatDate(c.issuedDate),
      expirationDate: formatDate(c.expirationDate),
      renewalDate: formatDate(c.renewalDate),
      renewalLeadDays: String(c.renewalLeadDays),
      reminderOffsetsDays: c.reminderOffsetsDays.join("|"),
      autoRenew: c.autoRenew ? "true" : "false",
      renewalCost:
        c.renewalCost !== null && c.renewalCost !== undefined
          ? String(c.renewalCost)
          : "",
      currency: c.currency || "",
      documentUrl: c.documentUrl || "",
      completedCertUrl: c.completedCertUrl || "",
      assigneeEmail: c.assignee?.email || "",
      pointOfContactEmail: c.pointOfContact?.email || "",
      clientName: c.client?.name || "",
    }));
  },

  async commit(rows, ctx) {
    const results: ImportRowResult[] = [];
    let imported = 0;
    const skipped = 0;
    let failed = 0;

    // Pre-fetch lookups
    const users = await db.user.findMany({
      select: { id: true, email: true },
      where: { isActive: true },
    });
    const userByEmail = new Map(users.map((u) => [u.email.toLowerCase(), u.id]));
    const clients = await db.client.findMany({ select: { id: true, name: true } });
    const clientByName = new Map(clients.map((c) => [c.name.toLowerCase(), c.id]));

    for (let i = 0; i < rows.length; i++) {
      const rowNumber = i + 1;
      const raw = rows[i];
      const name = (raw.name || "").trim();

      if (!name) {
        failed++;
        results.push({ row: rowNumber, status: "failed", message: "Missing name" });
        continue;
      }

      const statusRaw = (raw.status || "PENDING").trim().toUpperCase();
      const status = VALID_STATUSES.includes(statusRaw as CertificationStatus)
        ? (statusRaw as CertificationStatus)
        : null;
      if (!status) {
        failed++;
        results.push({ row: rowNumber, status: "failed", message: `Invalid status "${raw.status}"` });
        continue;
      }

      const typeRaw = (raw.type || "OTHER").trim().toUpperCase();
      const type = VALID_TYPES.includes(typeRaw as CertificationType)
        ? (typeRaw as CertificationType)
        : "OTHER";

      const jurisdictionRaw = (raw.jurisdictionLevel || "OTHER").trim().toUpperCase();
      const jurisdictionLevel = VALID_JURISDICTIONS.includes(
        jurisdictionRaw as JurisdictionLevel
      )
        ? (jurisdictionRaw as JurisdictionLevel)
        : "OTHER";

      const engagementRaw = (raw.engagementType || "CERTIFICATION").trim().toUpperCase();
      const engagementType = VALID_ENGAGEMENT_TYPES.includes(
        engagementRaw as CertEngagementType
      )
        ? (engagementRaw as CertEngagementType)
        : "CERTIFICATION";

      const assigneeEmail = (raw.assigneeEmail || "").trim().toLowerCase();
      const assigneeId = assigneeEmail ? userByEmail.get(assigneeEmail) || null : null;
      const pocEmail = (raw.pointOfContactEmail || "").trim().toLowerCase();
      const pointOfContactId = pocEmail ? userByEmail.get(pocEmail) || null : null;
      const clientName = (raw.clientName || "").trim().toLowerCase();
      const clientId = clientName ? clientByName.get(clientName) || null : null;
      const reminderOffsetsDays = parseOffsets(raw.reminderOffsetsDays);

      try {
        const cert = await db.certification.create({
          data: {
            name,
            plainEnglishSummary: raw.plainEnglishSummary?.trim() || null,
            status,
            type,
            engagementType,
            jurisdictionLevel,
            jurisdictionName: raw.jurisdictionName?.trim() || null,
            issuingBody: raw.issuingBody?.trim() || null,
            agencyWebsiteUrl: raw.agencyWebsiteUrl?.trim() || null,
            agencyContactName: raw.agencyContactName?.trim() || null,
            agencyContactEmail: raw.agencyContactEmail?.trim() || null,
            agencyContactPhone: raw.agencyContactPhone?.trim() || null,
            certNumber: raw.certNumber?.trim() || null,
            submittedDate: parseDate(raw.submittedDate),
            issuedDate: parseDate(raw.issuedDate),
            expirationDate: parseDate(raw.expirationDate),
            renewalDate: parseDate(raw.renewalDate),
            renewalLeadDays: raw.renewalLeadDays
              ? parseInt(raw.renewalLeadDays, 10) || 90
              : 90,
            ...(reminderOffsetsDays ? { reminderOffsetsDays } : {}),
            autoRenew: parseBool(raw.autoRenew, false),
            renewalCost: raw.renewalCost ? parseFloat(raw.renewalCost) || null : null,
            currency: raw.currency?.trim() || "USD",
            documentUrl: raw.documentUrl?.trim() || null,
            completedCertUrl: raw.completedCertUrl?.trim() || null,
            assigneeId,
            pointOfContactId,
            clientId,
          },
        });
        imported++;
        results.push({ row: rowNumber, status: "imported" });
        await logActivity("imported", "certification", cert.id, ctx.triggeredBy, name);
      } catch (err) {
        failed++;
        results.push({
          row: rowNumber,
          status: "failed",
          message: err instanceof Error ? err.message : "DB error",
        });
      }
    }

    return { imported, skipped, failed, rows: results };
  },
};
