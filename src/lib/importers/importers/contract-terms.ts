/**
 * Contract terms importer — bulk-create SLA / obligation / deadline rows
 * attached to existing contracts.
 *
 * Required: title, description, contractNumber
 * Optional: type, priority, dueDate
 *
 * The contract is matched by contractNumber so terms can be shipped in
 * the same import batch as their parent contract (which sets the number)
 * — the contracts importer registers new contractNumbers for in-batch
 * lookup, and this importer reads from the live DB on commit.
 */

import type { TermType, Priority } from "@prisma/client";
import { db } from "@/lib/db";
import { logActivity } from "@/lib/activity";
import type { ImporterDefinition, ImportRowResult } from "../types";

const VALID_TYPES: TermType[] = [
  "SLA",
  "OBLIGATION",
  "DEADLINE",
  "DELIVERABLE",
  "ESCALATION",
  "RENEWAL",
  "BILLING",
  "PENALTY",
  "OTHER",
];
const VALID_PRIORITIES: Priority[] = ["HIGH", "MEDIUM", "LOW"];

function parseDate(v: string | undefined): Date | null {
  if (!v || v.trim() === "") return null;
  const d = new Date(v.trim());
  return isNaN(d.getTime()) ? null : d;
}

function formatDate(d: Date | null | undefined): string {
  return d ? d.toISOString().slice(0, 10) : "";
}

export const contractTermsImporter: ImporterDefinition = {
  key: "contract-terms",
  name: "Contract Terms",
  description:
    "Bulk-create contract terms (SLAs, obligations, deadlines, deliverables, etc.). Required: title, description, contractNumber. Optional: type, priority, dueDate.",
  module: "contracts",

  fields: [
    { key: "title", label: "Title", required: true, aliases: ["term", "term title", "name"] },
    {
      key: "description",
      label: "Description",
      required: true,
      description: "What the term obligates, the SLA target, etc.",
      aliases: ["details", "body"],
    },
    {
      key: "contractNumber",
      label: "Contract number",
      required: true,
      description: "Must match an existing contract's contractNumber.",
      aliases: ["contract", "contract #", "ref"],
    },
    {
      key: "type",
      label: "Type",
      required: false,
      description: "SLA, OBLIGATION, DEADLINE, DELIVERABLE, ESCALATION, RENEWAL, BILLING, PENALTY, OTHER.",
      aliases: ["term type"],
    },
    { key: "priority", label: "Priority", required: false, description: "HIGH, MEDIUM, LOW. Defaults to MEDIUM.", aliases: ["term priority"] },
    { key: "dueDate", label: "Due date", required: false, aliases: ["due", "deadline date"] },
  ],

  async sampleRows() {
    const terms = await db.contractTerm.findMany({
      orderBy: { createdAt: "desc" },
      take: 3,
      include: { contract: { select: { contractNumber: true } } },
    });
    return terms.map((t) => ({
      title: t.title,
      description: t.description,
      contractNumber: t.contract.contractNumber || "",
      type: t.type,
      priority: t.priority || "MEDIUM",
      dueDate: formatDate(t.dueDate),
    }));
  },

  async commit(rows, ctx) {
    const results: ImportRowResult[] = [];
    let imported = 0;
    const skipped = 0;
    let failed = 0;

    const contracts = await db.contract.findMany({
      where: { contractNumber: { not: null } },
      select: { id: true, contractNumber: true, clientId: true, projectId: true },
    });
    const contractByNumber = new Map(
      contracts
        .filter((c): c is typeof c & { contractNumber: string } => Boolean(c.contractNumber))
        .map((c) => [c.contractNumber.toLowerCase(), c])
    );

    for (let i = 0; i < rows.length; i++) {
      const rowNumber = i + 1;
      const raw = rows[i];
      const title = (raw.title || "").trim();
      const description = (raw.description || "").trim();
      const contractNumberRaw = (raw.contractNumber || "").trim();

      if (!title) {
        failed++;
        results.push({ row: rowNumber, status: "failed", message: "Missing title" });
        continue;
      }
      if (!description) {
        failed++;
        results.push({ row: rowNumber, status: "failed", message: "Missing description" });
        continue;
      }
      if (!contractNumberRaw) {
        failed++;
        results.push({ row: rowNumber, status: "failed", message: "Missing contractNumber" });
        continue;
      }

      const contract = contractByNumber.get(contractNumberRaw.toLowerCase());
      if (!contract) {
        failed++;
        results.push({
          row: rowNumber,
          status: "failed",
          message: `Contract not found: "${contractNumberRaw}"`,
        });
        continue;
      }

      const typeRaw = (raw.type || "OTHER").trim().toUpperCase();
      const type = VALID_TYPES.includes(typeRaw as TermType) ? (typeRaw as TermType) : "OTHER";

      const priorityRaw = (raw.priority || "MEDIUM").trim().toUpperCase();
      const priority = VALID_PRIORITIES.includes(priorityRaw as Priority)
        ? (priorityRaw as Priority)
        : "MEDIUM";

      try {
        const term = await db.contractTerm.create({
          data: {
            title,
            description,
            type,
            priority,
            dueDate: parseDate(raw.dueDate),
            contractId: contract.id,
          },
        });
        imported++;
        results.push({ row: rowNumber, status: "imported" });
        await logActivity("imported", "contractTerm", term.id, ctx.triggeredBy, title, {
          clientId: contract.clientId,
          projectId: contract.projectId,
        });
      } catch (err) {
        failed++;
        results.push({
          row: rowNumber,
          status: "failed",
          message: err instanceof Error ? err.message : "DB error",
        });
      }
    }

    return { imported, updated: 0, skipped, failed, rows: results };
  },
};
