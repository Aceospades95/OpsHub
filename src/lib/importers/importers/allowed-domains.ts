/**
 * Allowed-domains importer — bulk-add SSO whitelist entries.
 *
 * Required: domain
 *
 * Domain values are normalized: lowercased, leading "@" or "https://"
 * stripped. Duplicates (already in the table or repeated within the
 * same batch) soft-skip rather than fail. There is no project/client
 * scope; this is global SSO config.
 */

import { db } from "@/lib/db";
import { logActivity } from "@/lib/activity";
import type { ImporterDefinition, ImportRowResult } from "../types";

function normalizeDomain(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^@/, "")
    .replace(/\/.*$/, "")
    .replace(/^www\./, "");
}

function isPlausibleDomain(d: string): boolean {
  // Permissive sanity check: at least one dot, no whitespace, no @.
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(d);
}

export const allowedDomainsImporter: ImporterDefinition = {
  key: "allowed-domains",
  name: "Allowed SSO Domains",
  description:
    "Bulk-add domains to the SSO allow-list. Required: domain. Values are normalized (lowercased, @ / https:// / leading www. stripped).",
  module: "settings",
  supportsUpsert: true,
  upsertKeyDescription:
    "Matched by normalized domain (case-insensitive, scheme/@/leading www. stripped). The row has no other editable fields, so upsert mode treats existing entries as updated no-ops instead of skipping them.",

  fields: [
    {
      key: "domain",
      label: "Domain",
      required: true,
      description: "The bare domain, e.g. company.com. @ prefix and https:// scheme are stripped.",
      aliases: ["email domain", "sso domain"],
    },
  ],

  async sampleRows() {
    const rows = await db.allowedDomain.findMany({
      orderBy: { createdAt: "desc" },
      take: 3,
    });
    return rows.map((r) => ({ domain: r.domain }));
  },

  async commit(rows, ctx) {
    const results: ImportRowResult[] = [];
    let imported = 0;
    let updated = 0;
    let skipped = 0;
    let failed = 0;
    const upsert = ctx.mode === "upsert";

    const existing = new Set(
      (await db.allowedDomain.findMany({ select: { domain: true } })).map((d) =>
        d.domain.toLowerCase()
      )
    );
    const seenInBatch = new Set<string>();

    for (let i = 0; i < rows.length; i++) {
      const rowNumber = i + 1;
      const raw = rows[i];
      const domainRaw = (raw.domain || "").trim();
      if (!domainRaw) {
        failed++;
        results.push({ row: rowNumber, status: "failed", message: "Missing domain" });
        continue;
      }

      const domain = normalizeDomain(domainRaw);
      if (!isPlausibleDomain(domain)) {
        failed++;
        results.push({
          row: rowNumber,
          status: "failed",
          message: `Not a plausible domain after normalization: "${domain}"`,
        });
        continue;
      }
      if (seenInBatch.has(domain)) {
        if (upsert) {
          updated++;
          results.push({ row: rowNumber, status: "updated" });
        } else {
          skipped++;
          results.push({
            row: rowNumber,
            status: "skipped",
            message: `Duplicate row in file: "${domain}"`,
          });
        }
        continue;
      }
      if (existing.has(domain)) {
        seenInBatch.add(domain);
        if (upsert) {
          // No editable fields beyond `domain` itself, so the upsert
          // is an effective no-op against the DB — but we still report
          // it as updated so admins re-running the same file see a
          // consistent count rather than mysterious skips.
          updated++;
          results.push({ row: rowNumber, status: "updated" });
        } else {
          skipped++;
          results.push({
            row: rowNumber,
            status: "skipped",
            message: `Domain already on the allow-list: "${domain}". Re-run with "Update existing rows" enabled to refresh it.`,
          });
        }
        continue;
      }

      try {
        const created = await db.allowedDomain.create({ data: { domain } });
        seenInBatch.add(domain);
        existing.add(domain);
        imported++;
        results.push({ row: rowNumber, status: "imported" });
        await logActivity("imported", "allowedDomain", created.id, ctx.triggeredBy, domain);
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
