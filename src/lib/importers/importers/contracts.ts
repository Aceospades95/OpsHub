/**
 * Contracts importer — bulk-create contract records from CSV.
 *
 * Required: title, clientName
 * Optional: status, contractType, contractNumber, value, currency,
 *           startDate, endDate, renewalDate, noticePeriodDays, autoRenew,
 *           description
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
    "Bulk-create contracts. Required: title, clientName. Optional: status, type, value, dates, renewal info.",
  module: "contracts",

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
    { key: "description", label: "Description", required: false, aliases: ["notes", "summary"] },
  ],

  async commit(rows, ctx) {
    const results: ImportRowResult[] = [];
    let imported = 0, skipped = 0, failed = 0;

    const clients = await db.client.findMany({ select: { id: true, name: true } });
    const clientByName = new Map(clients.map((c) => [c.name.toLowerCase(), c.id]));

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

      try {
        const contract = await db.contract.create({
          data: {
            title,
            clientId,
            status,
            contractType,
            contractNumber: raw.contractNumber?.trim() || null,
            value: raw.value ? parseFloat(raw.value) || null : null,
            currency: raw.currency?.trim() || "USD",
            startDate: parseDate(raw.startDate),
            endDate: parseDate(raw.endDate),
            renewalDate: parseDate(raw.renewalDate),
            noticePeriodDays: raw.noticePeriodDays ? parseInt(raw.noticePeriodDays, 10) || null : null,
            autoRenew: parseBool(raw.autoRenew, false),
            description: raw.description?.trim() || null,
          },
        });
        imported++; results.push({ row: rowNumber, status: "imported" });
        await logActivity("imported", "contract", contract.id, ctx.triggeredBy, title);
      } catch (err) {
        failed++; results.push({ row: rowNumber, status: "failed", message: err instanceof Error ? err.message : "DB error" });
      }
    }

    return { imported, skipped, failed, rows: results };
  },
};
