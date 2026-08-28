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
 *   - name is the match key, case-insensitive on the trimmed name.
 *     What happens on a match follows ctx.mode (create → skip,
 *     update/upsert → update, fill-blanks → only fill empty fields).
 *     Pre-2026-07 this importer ignored the mode and always upserted —
 *     that bug is fixed.
 *   - Fuzzy-duplicate guardrail: rows about to CREATE are also checked
 *     against live clients by NORMALIZED name (lowercase, collapsed
 *     whitespace, trailing punctuation stripped — see
 *     normalizeImportName). In create mode a normalized-only match is
 *     skipped as a possible duplicate instead of minting "Acme Corp."
 *     next to "Acme Corp"; other modes create as before but warn. The
 *     same guardrail catches normalized duplicates within one file.
 *   - status defaults to ACTIVE. Must be one of the ClientStatus enum
 *     values when supplied (case-insensitive).
 *   - accountManagerEmail resolves against existing Users in a second
 *     pass; unresolvable emails leave accountManagerId untouched (the
 *     row still imports with a warning — bad email shouldn't fail the
 *     import).
 *
 * NOT supported via this importer (use the UI for these):
 *   - Renaming a client. Renames look like "delete A + create B" to
 *     this importer because name is the match key. Use the client
 *     edit form for renames so existing FKs stay attached.
 *   - Deleting a client. CSV import is additive/upsert only.
 */

import type { ClientStatus } from "@prisma/client";
import { db } from "@/lib/db";
import type { ImporterDefinition, ImportRowResult } from "../types";
import {
  addWarning,
  applyMode,
  buildResult,
  logImportActivity,
  mergeFillBlanks,
  skipExistsMessage,
  skipNoMatchMessage,
  warnList,
} from "../helpers";

const VALID_STATUSES: ClientStatus[] = [
  "ACTIVE",
  "INACTIVE",
  "PROSPECT",
  "ARCHIVED",
];

/**
 * Fuzzy-dedupe normalization shared by the clients + projects importers
 * and the possible-duplicates report: lowercase, collapse internal
 * whitespace, trim, strip trailing punctuation runs ("Acme Corp." /
 * "acme  corp" / " Acme Corp " all normalize to "acme corp").
 *
 * Deliberately SEPARATE from the exact natural key (trimmed lowercase
 * name) that drives create/update/upsert matching — normalization only
 * powers the possible-duplicate guardrail, never the match itself.
 * Returns "" for names that are nothing but whitespace/punctuation;
 * callers must skip normalized matching in that case.
 */
export function normalizeImportName(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[\s.,;:!?\-–—_/\\]+$/, "");
}

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
    const db = ctx.db; // ALL commit reads/writes go through ctx.db
    const results: ImportRowResult[] = [];

    // Pre-fetch existing clients keyed by lowercased trimmed name so
    // duplicate detection AND the UPDATE path share one read.
    const allClients = await db.client.findMany({
      select: { id: true, name: true, deletedAt: true },
    });
    const existingByName = new Map<string, { id: string }>(
      allClients.map((c) => [c.name.trim().toLowerCase(), { id: c.id }])
    );
    // Fuzzy-dupe guardrail: live (non-deleted) clients by normalized
    // name. Updated after every create so in-file variants are caught
    // too. Soft-deleted clients stay in the EXACT map above (existing
    // semantics) but never flag a possible duplicate.
    const existingByNorm = new Map<string, { id: string; name: string }>();
    for (const c of allClients) {
      if (c.deletedAt) continue;
      const norm = normalizeImportName(c.name);
      if (!norm || existingByNorm.has(norm)) continue;
      existingByNorm.set(norm, { id: c.id, name: c.name });
    }

    const seenInBatch = new Set<string>();
    /** Rows that need an account-manager link resolved post-batch.
     *  resultIndex lets an unresolved email warn on the right row. */
    const pendingManagerLinks: {
      clientId: string;
      managerEmail: string;
      managerEmailRaw: string;
      resultIndex: number;
    }[] = [];

    for (let i = 0; i < rows.length; i++) {
      const rowNumber = i + 1;
      const raw = rows[i];
      const warnings: string[] = [];

      const name = (raw.name || "").trim();
      if (!name) {
        results.push({ row: rowNumber, status: "failed", message: "Missing name" });
        continue;
      }

      const nameKey = name.toLowerCase();
      if (seenInBatch.has(nameKey)) {
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
      const modeAction = applyMode(existing, ctx.mode);

      if (modeAction === "skip") {
        results.push({
          row: rowNumber,
          status: "skipped",
          message: existing
            ? skipExistsMessage(`Client "${name}"`)
            : skipNoMatchMessage(`Client "${name}"`),
        });
        continue;
      }

      // About to CREATE with no exact-key match — check for a live
      // client whose NORMALIZED name collides ("Acme Corp." vs
      // "acme corp"). In create mode that's a skip, not a new record;
      // update/upsert/fill-blanks keep their exact-match semantics and
      // just carry a warning on the created row.
      const norm = normalizeImportName(name);
      const normMatch =
        modeAction === "create" && norm ? existingByNorm.get(norm) : undefined;
      if (normMatch) {
        if ((ctx.mode ?? "create") === "create") {
          results.push({
            row: rowNumber,
            status: "skipped",
            message: `Possible duplicate of "${normMatch.name}" — skipped in "Create new only" mode. Rename the row if it really is a different client, or re-run in "Create + update" mode.`,
          });
          continue;
        }
        warnings.push(`Possible duplicate of existing client "${normMatch.name}" — created anyway`);
      }

      try {
        let clientId: string;
        let action: "imported" | "updated";
        if (modeAction === "update" && existing) {
          let updateData: Partial<typeof data> = data;
          if (ctx.mode === "fill-blanks") {
            const current = await db.client.findUnique({ where: { id: existing.id } });
            updateData = mergeFillBlanks(current, data);
          }
          await db.client.update({ where: { id: existing.id }, data: updateData });
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
          // Register the fresh row for the fuzzy guardrail so a later
          // in-file variant ("Acme Corp" then "acme corp.") is flagged.
          if (norm && !existingByNorm.has(norm)) {
            existingByNorm.set(norm, { id: clientId, name });
          }
        }

        const managerEmail = (raw.accountManagerEmail || "").trim().toLowerCase();
        if (managerEmail) {
          pendingManagerLinks.push({
            clientId,
            managerEmail,
            managerEmailRaw: (raw.accountManagerEmail || "").trim(),
            resultIndex: results.length,
          });
        }

        results.push({ row: rowNumber, status: action, warnings: warnList(warnings) });

        await logImportActivity(ctx, action, "client", clientId, name);
      } catch (err) {
        results.push({
          row: rowNumber,
          status: "failed",
          message: err instanceof Error ? err.message : "DB error",
        });
      }
    }

    // Second pass — resolve account-manager emails. An unresolved
    // email no longer drops silently: the row keeps its written status
    // but records a warning.
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
        const target = results[link.resultIndex];
        const managerId = byEmail.get(link.managerEmail);
        if (!managerId) {
          addWarning(target, `Account manager not found: "${link.managerEmailRaw}" — link not set`);
          continue;
        }
        try {
          if (ctx.mode === "fill-blanks") {
            // Never overwrite an existing account manager.
            await db.client.updateMany({
              where: { id: link.clientId, accountManagerId: null },
              data: { accountManagerId: managerId },
            });
          } else {
            await db.client.update({
              where: { id: link.clientId },
              data: { accountManagerId: managerId },
            });
          }
        } catch {
          addWarning(target, `Account manager link to "${link.managerEmailRaw}" could not be written`);
        }
      }
    }

    return buildResult(results);
  },
};
