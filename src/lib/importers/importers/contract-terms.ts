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

/** Build the natural-key string used for upsert matching. (contractId +
 *  title) lowercased — the same title can live under multiple contracts.
 *  contractId is already a stable id at the time we build the key, so no
 *  separator collision concerns. */
function termMatchKey(contractId: string, title: string): string {
  return `${contractId}|${title.trim().toLowerCase()}`;
}

export const contractTermsImporter: ImporterDefinition = {
  key: "contract-terms",
  name: "Contract Terms",
  description:
    "Bulk-create or update contract terms (SLAs, obligations, deadlines, deliverables, etc.). Required: title, description, contractNumber. Optional: type, priority, dueDate.",
  module: "contracts",
  supportsUpsert: true,
  upsertKeyDescription:
    "Matched by (contract + title), case-insensitive on title. Re-uploading the same title under the same contract updates the existing row instead of creating a duplicate.",

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
    let updated = 0;
    let skipped = 0;
    let failed = 0;
    const upsert = ctx.mode === "upsert";

    const contracts = await db.contract.findMany({
      where: { contractNumber: { not: null } },
      select: { id: true, contractNumber: true, clientId: true, projectId: true },
    });
    const contractByNumber = new Map(
      contracts
        .filter((c): c is typeof c & { contractNumber: string } => Boolean(c.contractNumber))
        .map((c) => [c.contractNumber.toLowerCase(), c])
    );

    // Pre-fetch every term keyed by (contractId + lowercased title) for
    // upsert matching and in-batch dedupe.
    const existingTerms = await db.contractTerm.findMany({
      select: { id: true, title: true, contractId: true },
    });
    const existingByKey = new Map<string, { id: string }>(
      existingTerms.map((t) => [termMatchKey(t.contractId, t.title), { id: t.id }])
    );
    const seenInBatch = new Set<string>();

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

      const key = termMatchKey(contract.id, title);
      if (seenInBatch.has(key)) {
        skipped++;
        results.push({
          row: rowNumber,
          status: "skipped",
          message: `Duplicate row in file: "${title}" on ${contractNumberRaw}`,
        });
        continue;
      }
      seenInBatch.add(key);

      const data = {
        title,
        description,
        type,
        priority,
        dueDate: parseDate(raw.dueDate),
        contractId: contract.id,
      };

      const existing = existingByKey.get(key);

      try {
        if (existing && upsert) {
          const term = await db.contractTerm.update({
            where: { id: existing.id },
            data,
          });
          updated++;
          results.push({ row: rowNumber, status: "updated" });
          await logActivity("imported", "contractTerm", term.id, ctx.triggeredBy, `${title} (updated)`, {
            clientId: contract.clientId,
            projectId: contract.projectId,
          });
        } else if (existing && !upsert) {
          skipped++;
          results.push({
            row: rowNumber,
            status: "skipped",
            message: `Term already exists: "${title}" on ${contractNumberRaw}. Re-run with "Update existing rows" enabled to update it.`,
          });
        } else {
          const term = await db.contractTerm.create({ data });
          existingByKey.set(key, { id: term.id });
          imported++;
          results.push({ row: rowNumber, status: "imported" });
          await logActivity("imported", "contractTerm", term.id, ctx.triggeredBy, title, {
            clientId: contract.clientId,
            projectId: contract.projectId,
          });
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
