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
import type { ImporterDefinition, ImportRowResult } from "../types";
import {
  applyMode,
  buildResult,
  logImportActivity,
  skipExistsMessage,
  skipNoMatchMessage,
} from "../helpers";

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
    const db = ctx.db; // ALL commit reads/writes go through ctx.db
    const results: ImportRowResult[] = [];

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
        results.push({ row: rowNumber, status: "failed", message: "Missing domain" });
        continue;
      }

      const domain = normalizeDomain(domainRaw);
      if (!isPlausibleDomain(domain)) {
        results.push({
          row: rowNumber,
          status: "failed",
          message: `Not a plausible domain after normalization: "${domain}"`,
        });
        continue;
      }
      if (seenInBatch.has(domain)) {
        results.push({
          row: rowNumber,
          status: "skipped",
          message: `Duplicate row in file: "${domain}"`,
        });
        continue;
      }
      seenInBatch.add(domain);

      const action = applyMode(existing.has(domain), ctx.mode);

      if (action === "update") {
        // No editable fields beyond `domain` itself, so the update is
        // an effective no-op against the DB — but we still report it
        // as updated so admins re-running the same file see a
        // consistent count rather than mysterious skips.
        results.push({ row: rowNumber, status: "updated" });
        continue;
      }
      if (action === "skip") {
        results.push({
          row: rowNumber,
          status: "skipped",
          message: existing.has(domain)
            ? skipExistsMessage(`Domain "${domain}"`)
            : skipNoMatchMessage(`Domain "${domain}"`),
        });
        continue;
      }

      try {
        const created = await db.allowedDomain.create({ data: { domain } });
        existing.add(domain);
        results.push({ row: rowNumber, status: "imported" });
        await logImportActivity(ctx, "imported", "allowedDomain", created.id, domain);
      } catch (err) {
        results.push({
          row: rowNumber,
          status: "failed",
          message: err instanceof Error ? err.message : "DB error",
        });
      }
    }

    return buildResult(results);
  },
};
