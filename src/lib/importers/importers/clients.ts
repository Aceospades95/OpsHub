/**
 * Clients importer — bulk-create or update Client records from a CSV.
 *
 * This was missing from the registry pre-V1, which made the round-trip
 * "export current data → edit in Excel → re-upload" flow impossible
 * for the top-level Client entity. Adding it closes that gap and
 * follows the same upsert pattern as users.
 *
 * Required: name
 * Optional: industry, website, status, accountManagerEmail, description, summary
 *
 * Behavior:
 *   - name is the de-dup key. Match is case-insensitive on the trimmed
 *     name. Existing rows UPDATE; new rows INSERT. Re-uploading is
 *     idempotent when names haven't changed.
 *   - status defaults to ACTIVE. Must be one of the ClientStatus enum
 *     values when supplied (case-insensitive).
 *   - accountManagerEmail resolves against existing Users in a second
 *     pass; unresolvable emails leave accountManagerId untouched (the
 *     row still imports — bad email shouldn't fail the import).
 *
 * NOT supported via this importer (use the UI for these):
 *   - Renaming a client. Renames look like "delete A + create B" to
 *     this importer because name is the match key. Use the client
 *     edit form for renames so existing FKs stay attached.
 *   - Deleting a client. CSV import is additive/upsert only.
 */

import type { ClientStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { logActivity } from "@/lib/activity";
import type { ImporterDefinition, ImportRowResult } from "../types";

const VALID_STATUSES: ClientStatus[] = [
  "ACTIVE",
  "INACTIVE",
  "PROSPECT",
  "ARCHIVED",
];

export const clientsImporter: ImporterDefinition = {
  key: "clients",
  name: "Clients",
  description:
    "Bulk-create or update client accounts from a CSV. Name is the match key — re-running the file with edits updates existing rows. Required: name. Optional: industry, website, status, accountManagerEmail, description, summary.",
  module: "clients",
  supportsUpsert: true,
  upsertKeyDescription:
    "Always matched by client name (case-insensitive). Existing rows are updated when name matches; new names create new clients. Renaming a client must be done from the UI, not the importer.",

  fields: [
    {
      key: "name",
      label: "Name",
      required: true,
      aliases: ["client name", "company", "company name", "account"],
    },
    {
      key: "industry",
      label: "Industry",
      required: false,
      aliases: ["sector", "vertical"],
    },
    {
      key: "website",
      label: "Website",
      required: false,
      aliases: ["url", "homepage"],
    },
    {
      key: "status",
      label: "Status",
      required: false,
      description: "ACTIVE, INACTIVE, PROSPECT, or ARCHIVED. Defaults to ACTIVE.",
    },
    {
      key: "accountManagerEmail",
      label: "Account manager email",
      required: false,
      description:
        "Email of the user who owns this account. Resolved against existing employees; ignored silently if no match.",
      aliases: ["account manager", "owner email", "manager email"],
    },
    {
      key: "description",
      label: "Description",
      required: false,
      aliases: ["notes", "about"],
    },
    {
      key: "summary",
      label: "Summary",
      required: false,
      aliases: ["short description"],
    },
  ],

  async sampleRows() {
    const clients = await db.client.findMany({
      where: { status: "ACTIVE" },
      orderBy: { createdAt: "desc" },
      take: 3,
      include: { accountManager: { select: { email: true } } },
    });
    return clients.map((c) => ({
      name: c.name,
      industry: c.industry || "",
      website: c.website || "",
      status: c.status,
      accountManagerEmail: c.accountManager?.email || "",
      description: c.description || "",
      summary: c.summary || "",
    }));
  },

  async exportRows() {
    // Every client, in the same column shape commit() expects. Safe
    // round-trip — name match + value-by-value update.
    const clients = await db.client.findMany({
      orderBy: [{ status: "asc" }, { name: "asc" }],
      include: { accountManager: { select: { email: true } } },
    });
    return clients.map((c) => ({
      name: c.name,
      industry: c.industry || "",
      website: c.website || "",
      status: c.status,
      accountManagerEmail: c.accountManager?.email || "",
      description: c.description || "",
      summary: c.summary || "",
    }));
  },

  async commit(rows, ctx) {
    const results: ImportRowResult[] = [];
    let imported = 0;
    let updated = 0;
    let skipped = 0;
    let failed = 0;

    // Pre-fetch existing clients keyed by lowercased trimmed name so
    // duplicate detection AND the UPDATE path share one read.
    const existingByName = new Map<string, { id: string }>(
      (
        await db.client.findMany({ select: { id: true, name: true } })
      ).map((c) => [c.name.trim().toLowerCase(), { id: c.id }])
    );

    const seenInBatch = new Set<string>();
    /** Rows that need an account-manager link resolved post-batch. */
    const pendingManagerLinks: { clientId: string; managerEmail: string }[] = [];

    for (let i = 0; i < rows.length; i++) {
      const rowNumber = i + 1;
      const raw = rows[i];

      const name = (raw.name || "").trim();
      if (!name) {
        failed++;
        results.push({ row: rowNumber, status: "failed", message: "Missing name" });
        continue;
      }

      const nameKey = name.toLowerCase();
      if (seenInBatch.has(nameKey)) {
        skipped++;
        results.push({
          row: rowNumber,
          status: "skipped",
          message: `Duplicate row in file: "${name}"`,
        });
        continue;
      }
      seenInBatch.add(nameKey);

      const statusRaw = (raw.status || "ACTIVE").trim().toUpperCase();
      const status = VALID_STATUSES.includes(statusRaw as ClientStatus)
        ? (statusRaw as ClientStatus)
        : null;
      if (!status) {
        failed++;
        results.push({
          row: rowNumber,
          status: "failed",
          message: `Invalid status "${raw.status}" — must be one of ${VALID_STATUSES.join(", ")}`,
        });
        continue;
      }

      const data = {
        name,
        industry: raw.industry?.trim() || null,
        website: raw.website?.trim() || null,
        status,
        description: raw.description?.trim() || null,
        summary: raw.summary?.trim() || null,
      };

      const existing = existingByName.get(nameKey);

      try {
        let clientId: string;
        let action: "imported" | "updated";
        if (existing) {
          await db.client.update({ where: { id: existing.id }, data });
          clientId = existing.id;
          action = "updated";
        } else {
          const created = await db.client.create({
            data: { ...data, accountManagerId: null },
            select: { id: true },
          });
          clientId = created.id;
          action = "imported";
          existingByName.set(nameKey, { id: clientId });
        }

        if (action === "updated") {
          updated++;
          results.push({ row: rowNumber, status: "updated" });
        } else {
          imported++;
          results.push({ row: rowNumber, status: "imported" });
        }

        const managerEmail = (raw.accountManagerEmail || "").trim().toLowerCase();
        if (managerEmail) {
          pendingManagerLinks.push({ clientId, managerEmail });
        }

        await logActivity(action, "client", clientId, ctx.triggeredBy, name);
      } catch (err) {
        failed++;
        results.push({
          row: rowNumber,
          status: "failed",
          message: err instanceof Error ? err.message : "DB error",
        });
      }
    }

    // Second pass — resolve account-manager emails. Silently leave
    // accountManagerId unchanged when no User matches.
    if (pendingManagerLinks.length > 0) {
      const emails = Array.from(
        new Set(pendingManagerLinks.map((p) => p.managerEmail))
      );
      const managers = await db.user.findMany({
        where: { email: { in: emails, mode: "insensitive" } },
        select: { id: true, email: true },
      });
      const byEmail = new Map(
        managers.map((m) => [m.email.toLowerCase(), m.id])
      );
      for (const link of pendingManagerLinks) {
        const managerId = byEmail.get(link.managerEmail);
        if (managerId) {
          await db.client.update({
            where: { id: link.clientId },
            data: { accountManagerId: managerId },
          });
        }
      }
    }

    return { imported, updated, skipped, failed, rows: results };
  },
};
