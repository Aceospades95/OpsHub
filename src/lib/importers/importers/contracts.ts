/**
 * Contracts importer — bulk-create contract records from CSV.
 *
 * Required: title, clientName
 * Optional: status, contractType, contractNumber, value, currency,
 *           startDate, endDate, renewalDate, noticePeriodDays, autoRenew,
 *           description, summary, externalDocumentUrl, documentSourceType,
 *           documentSourceLabel, parentContractNumber, projectName
 */

import type { ContractStatus, ContractType } from "@prisma/client";
import { db } from "@/lib/db";
import { logActivity } from "@/lib/activity";
import type { ImporterDefinition, ImportResult, ImportRowResult } from "../types";

const VALID_STATUSES: ContractStatus[] = [
  "DRAFT", "UNDER_REVIEW", "ACTIVE", "EXPIRING_SOON", "EXPIRED", "TERMINATED", "RENEWED",
];
const VALID_TYPES: ContractType[] = [
  "MSA", "SOW", "NDA", "Amendment", "Other",
];

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

export const contractsImporter: ImporterDefinition = {
  key: "contracts",
  name: "Contracts",
  description:
    "Bulk-create contracts. Required: title, clientName. Optional: status, type, value, dates, renewal info, Google Drive link, parent contract, project link.",
  module: "contracts",
  supportsUpsert: true,
  upsertKeyDescription:
    "Matched by contract number when present; otherwise by (client + title). Rows without a contract number that share both client and title with an existing contract will be updated.",

  fields: [
    { key: "title", label: "Contract title", required: true, aliases: ["name", "contract name", "contract title"] },
    { key: "clientName", label: "Client name", required: true, description: "Must match an existing client by name.", aliases: ["client", "company", "account"] },
    { key: "status", label: "Status", required: false, description: "DRAFT, ACTIVE, EXPIRED, etc. Defaults to DRAFT.", aliases: ["contract status"] },
    { key: "contractType", label: "Type", required: false, description: "MSA, SOW, NDA, Amendment, Other.", aliases: ["type", "contract type"] },
    { key: "contractNumber", label: "Contract number", required: false, aliases: ["number", "contract #", "ref"] },
    { key: "value", label: "Value", required: false, aliases: ["amount", "contract value", "price"] },
    { key: "currency", label: "Currency", required: false, description: "Defaults to USD.", aliases: ["currency code"] },
    { key: "startDate", label: "Start date", required: false, aliases: ["start", "effective date"] },
    { key: "endDate", label: "End date", required: false, aliases: ["end", "expiry", "termination date"] },
    { key: "renewalDate", label: "Renewal date", required: false, aliases: ["renewal", "renew by"] },
    { key: "noticePeriodDays", label: "Notice period (days)", required: false, aliases: ["notice period", "notice days"] },
    { key: "autoRenew", label: "Auto-renew", required: false, description: "true/false. Defaults to false.", aliases: ["auto renew"] },
    { key: "description", label: "Description", required: false, aliases: ["notes"] },
    { key: "summary", label: "Summary", required: false, description: "Long-form summary; appears on the contract detail page.", aliases: ["plain summary", "executive summary"] },
    {
      key: "externalDocumentUrl",
      label: "Document URL",
      required: false,
      description: "Link to the live contract document, e.g. a Google Drive URL.",
      aliases: ["google drive", "drive link", "document link", "doc url", "google drive link", "contract url"],
    },
    {
      key: "documentSourceType",
      label: "Document source type",
      required: false,
      description: "google_drive, external_url, upload, or other. Defaults to external_url when a URL is provided.",
      aliases: ["doc source", "source type"],
    },
    {
      key: "documentSourceLabel",
      label: "Document source label",
      required: false,
      description: "Human-readable label shown next to the document link, e.g. \"Drive\" or \"Final PDF\".",
      aliases: ["doc label", "source label"],
    },
    {
      key: "parentContractNumber",
      label: "Parent contract number",
      required: false,
      description: "Links this contract as a child of an existing one (matched by contract number).",
      aliases: ["parent contract", "parent number", "parent ref"],
    },
    {
      key: "projectName",
      label: "Project name",
      required: false,
      description: "Optionally scope this contract to an existing project by name.",
      aliases: ["project", "project ref"],
    },
  ],

  async sampleRows() {
    const contracts = await db.contract.findMany({
      orderBy: { createdAt: "desc" },
      take: 3,
      include: {
        client: { select: { name: true } },
        project: { select: { name: true } },
        parentContract: { select: { contractNumber: true } },
      },
    });
    return contracts.map((c) => ({
      title: c.title,
      clientName: c.client.name,
      status: c.status,
      contractType: c.contractType || "",
      contractNumber: c.contractNumber || "",
      value: c.value !== null && c.value !== undefined ? String(c.value) : "",
      currency: c.currency || "",
      startDate: formatDate(c.startDate),
      endDate: formatDate(c.endDate),
      renewalDate: formatDate(c.renewalDate),
      noticePeriodDays:
        c.noticePeriodDays !== null && c.noticePeriodDays !== undefined
          ? String(c.noticePeriodDays)
          : "",
      autoRenew: c.autoRenew ? "true" : "false",
      description: c.description || "",
      summary: c.summary || "",
      externalDocumentUrl: c.externalDocumentUrl || "",
      documentSourceType: c.documentSourceType || "",
      documentSourceLabel: c.documentSourceLabel || "",
      parentContractNumber: c.parentContract?.contractNumber || "",
      projectName: c.project?.name || "",
    }));
  },

  async commit(rows, ctx) {
    const results: ImportRowResult[] = [];
    let imported = 0;
    let updated = 0;
    const skipped = 0;
    let failed = 0;
    const upsert = ctx.mode === "upsert";

    const clients = await db.client.findMany({ select: { id: true, name: true } });
    const clientByName = new Map(clients.map((c) => [c.name.toLowerCase(), c.id]));

    // Pre-fetch parent-contract candidates and projects so we can resolve the
    // optional parentContractNumber and projectName columns without a query
    // per row.
    const parents = await db.contract.findMany({
      where: { contractNumber: { not: null } },
      select: { id: true, contractNumber: true },
    });
    const parentByNumber = new Map(
      parents
        .filter((p): p is { id: string; contractNumber: string } => Boolean(p.contractNumber))
        .map((p) => [p.contractNumber.toLowerCase(), p.id])
    );
    const projects = await db.project.findMany({ select: { id: true, name: true } });
    const projectByName = new Map(projects.map((p) => [p.name.toLowerCase(), p.id]));

    // Pre-fetch every existing contract once so we can match by
    // contractNumber (preferred) or (clientId + title) (fallback) without
    // hitting the DB per row. Cheap because contract counts are typically
    // in the low thousands; if this grows we can shard by clientId.
    const existing = await db.contract.findMany({
      select: { id: true, title: true, clientId: true, contractNumber: true },
    });
    const byNumber = new Map(
      existing
        .filter((c): c is { id: string; title: string; clientId: string; contractNumber: string } => Boolean(c.contractNumber))
        .map((c) => [c.contractNumber.toLowerCase(), c.id])
    );
    const byClientTitle = new Map(
      existing.map((c) => [`${c.clientId}::${c.title.toLowerCase()}`, c.id])
    );

    for (let i = 0; i < rows.length; i++) {
      const rowNumber = i + 1;
      const raw = rows[i];
      const title = (raw.title || "").trim();
      const clientNameRaw = (raw.clientName || "").trim();

      if (!title) { failed++; results.push({ row: rowNumber, status: "failed", message: "Missing title" }); continue; }
      if (!clientNameRaw) { failed++; results.push({ row: rowNumber, status: "failed", message: "Missing client name" }); continue; }

      const clientId = clientByName.get(clientNameRaw.toLowerCase());
      if (!clientId) { failed++; results.push({ row: rowNumber, status: "failed", message: `Client not found: "${clientNameRaw}"` }); continue; }

      const statusRaw = (raw.status || "DRAFT").trim().toUpperCase();
      const status = VALID_STATUSES.includes(statusRaw as ContractStatus) ? (statusRaw as ContractStatus) : null;
      if (!status) { failed++; results.push({ row: rowNumber, status: "failed", message: `Invalid status "${raw.status}"` }); continue; }

      const typeRaw = (raw.contractType || "").trim();
      const contractType = typeRaw
        ? VALID_TYPES.find((t) => t.toUpperCase() === typeRaw.toUpperCase()) || null
        : null;

      // Resolve parent contract by contract number (case-insensitive). Soft
      // failure: unknown parent number → skip the link rather than failing
      // the row, since callers may import children before parents.
      const parentNumberRaw = (raw.parentContractNumber || "").trim();
      const parentContractId = parentNumberRaw
        ? parentByNumber.get(parentNumberRaw.toLowerCase()) || null
        : null;

      const projectNameRaw = (raw.projectName || "").trim();
      const projectId = projectNameRaw
        ? projectByName.get(projectNameRaw.toLowerCase()) || null
        : null;

      // If a document URL is given but no source type, default to external_url
      // (for google_drive/etc., the importer requires the caller to set it
      // explicitly so downstream UI can render the right icon/label).
      const externalDocumentUrl = raw.externalDocumentUrl?.trim() || null;
      const documentSourceTypeRaw = raw.documentSourceType?.trim().toLowerCase() || null;
      const documentSourceType = documentSourceTypeRaw
        ? documentSourceTypeRaw
        : externalDocumentUrl
        ? "external_url"
        : null;

      const contractNumberRaw = raw.contractNumber?.trim() || null;
      const data = {
        title,
        clientId,
        status,
        contractType,
        contractNumber: contractNumberRaw,
        value: raw.value ? parseFloat(raw.value) || null : null,
        currency: raw.currency?.trim() || "USD",
        startDate: parseDate(raw.startDate),
        endDate: parseDate(raw.endDate),
        renewalDate: parseDate(raw.renewalDate),
        noticePeriodDays: raw.noticePeriodDays ? parseInt(raw.noticePeriodDays, 10) || null : null,
        autoRenew: parseBool(raw.autoRenew, false),
        description: raw.description?.trim() || null,
        summary: raw.summary?.trim() || null,
        externalDocumentUrl,
        documentSourceType,
        documentSourceLabel: raw.documentSourceLabel?.trim() || null,
        parentContractId,
        projectId,
      };

      // Resolve the natural key. Contract number first (highest signal),
      // then (clientId + title) as a fallback so contracts without a
      // number still match on re-upload.
      const existingId =
        (contractNumberRaw && byNumber.get(contractNumberRaw.toLowerCase())) ||
        byClientTitle.get(`${clientId}::${title.toLowerCase()}`) ||
        null;

      try {
        if (existingId && upsert) {
          const contract = await db.contract.update({ where: { id: existingId }, data });
          updated++; results.push({ row: rowNumber, status: "updated" });
          await logActivity("imported", "contract", contract.id, ctx.triggeredBy, `${title} (updated)`, {
            clientId: contract.clientId,
            projectId: contract.projectId,
          });
          if (contract.contractNumber) {
            parentByNumber.set(contract.contractNumber.toLowerCase(), contract.id);
          }
        } else if (existingId && !upsert) {
          // Create-only mode: don't duplicate. Skip with a clear message
          // pointing the user at the upsert toggle.
          results.push({
            row: rowNumber,
            status: "skipped",
            message: `Already exists (matched by ${contractNumberRaw ? "contract number" : "client + title"}). Re-run with "Update existing rows" enabled to update it.`,
          });
        } else {
          const contract = await db.contract.create({ data });
          imported++; results.push({ row: rowNumber, status: "imported" });
          await logActivity("imported", "contract", contract.id, ctx.triggeredBy, title, {
            clientId: contract.clientId,
            projectId: contract.projectId,
          });
          if (contract.contractNumber) {
            parentByNumber.set(contract.contractNumber.toLowerCase(), contract.id);
            byNumber.set(contract.contractNumber.toLowerCase(), contract.id);
          }
          byClientTitle.set(`${contract.clientId}::${contract.title.toLowerCase()}`, contract.id);
        }
      } catch (err) {
        failed++; results.push({ row: rowNumber, status: "failed", message: err instanceof Error ? err.message : "DB error" });
      }
    }

    // skipped is incremented in the !upsert branch via results.push but
    // the local var stays 0 because we counted via results length below.
    const skippedTotal = results.filter((r) => r.status === "skipped").length;
    return { imported, updated, skipped: skipped + skippedTotal, failed, rows: results };
  },

  async exportRows() {
    const contracts = await db.contract.findMany({
      orderBy: { updatedAt: "desc" },
      include: {
        client: { select: { name: true } },
        project: { select: { name: true } },
        parentContract: { select: { contractNumber: true } },
      },
    });
    return contracts.map((c) => ({
      title: c.title,
      clientName: c.client.name,
      status: c.status,
      contractType: c.contractType || "",
      contractNumber: c.contractNumber || "",
      value: c.value !== null && c.value !== undefined ? String(c.value) : "",
      currency: c.currency || "",
      startDate: formatDate(c.startDate),
      endDate: formatDate(c.endDate),
      renewalDate: formatDate(c.renewalDate),
      noticePeriodDays:
        c.noticePeriodDays !== null && c.noticePeriodDays !== undefined
          ? String(c.noticePeriodDays)
          : "",
      autoRenew: c.autoRenew ? "true" : "false",
      description: c.description || "",
      summary: c.summary || "",
      externalDocumentUrl: c.externalDocumentUrl || "",
      documentSourceType: c.documentSourceType || "",
      documentSourceLabel: c.documentSourceLabel || "",
      parentContractNumber: c.parentContract?.contractNumber || "",
      projectName: c.project?.name || "",
    }));
  },
};
