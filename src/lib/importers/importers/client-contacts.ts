/**
 * Client contacts importer — bulk-create or update per-client contact rows
 * from CSV.
 *
 * Required: name, clientName
 * Optional: title, email, phone, isPrimary, notes
 *
 * Upsert match key: (clientId + email) lowercased when an email is
 * present; falls back to (clientId + name) lowercased when email is
 * blank. This way migration files with email addresses match cleanly,
 * and contacts entered via name-only legacy spreadsheets still upsert.
 *
 * When isPrimary=true on a create or upsert, any existing primary
 * contact on the same client is unset (matches the createContact
 * server action behavior).
 */

import { db } from "@/lib/db";
import type { ImporterDefinition, ImportRowResult } from "../types";
import {
  applyMode,
  buildResult,
  logImportActivity,
  mergeFillBlanks,
  skipExistsMessage,
  skipNoMatchMessage,
} from "../helpers";

function parseBool(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined || value === "") return defaultValue;
  const v = value.trim().toLowerCase();
  if (["false", "no", "0", "off"].includes(v)) return false;
  if (["true", "yes", "1", "on"].includes(v)) return true;
  return defaultValue;
}

/** Build the natural-key string used for upsert matching. Prefers email
 *  (the more stable identifier) and falls back to name only when no
 *  email is given. Both halves are lowercased. */
function contactMatchKey(
  clientId: string,
  email: string | null | undefined,
  name: string
): string {
  const emailKey = (email || "").trim().toLowerCase();
  if (emailKey) return `${clientId}|email|${emailKey}`;
  return `${clientId}|name|${name.trim().toLowerCase()}`;
}

export const clientContactsImporter: ImporterDefinition = {
  key: "client-contacts",
  name: "Client Contacts",
  description:
    "Bulk-create or update per-client contacts. Required: name, clientName. Optional: title, email, phone, isPrimary, notes.",
  module: "clients",
  supportsUpsert: true,
  upsertKeyDescription:
    "Matched by (client + email), case-insensitive. When email is blank, falls back to (client + name). Re-uploading the same contact under the same client updates the existing row instead of creating a duplicate.",

  fields: [
    { key: "name", label: "Contact name", required: true, aliases: ["full name", "person"] },
    { key: "clientName", label: "Client name", required: true, description: "Must match an existing client by name.", aliases: ["client", "company", "account"] },
    { key: "title", label: "Title", required: false, aliases: ["job title", "position"] },
    { key: "email", label: "Email", required: false, aliases: ["email address", "e-mail"] },
    { key: "phone", label: "Phone", required: false, aliases: ["telephone", "mobile"] },
    {
      key: "isPrimary",
      label: "Is primary",
      required: false,
      description: "true / false. true unsets any existing primary contact on the same client.",
      aliases: ["primary"],
    },
    { key: "notes", label: "Notes", required: false, aliases: ["comments", "description"] },
  ],

  async sampleRows() {
    const contacts = await db.clientContact.findMany({
      orderBy: { createdAt: "desc" },
      take: 3,
      include: { client: { select: { name: true } } },
    });
    return contacts.map((c) => ({
      name: c.name,
      clientName: c.client.name,
      title: c.title || "",
      email: c.email || "",
      phone: c.phone || "",
      isPrimary: c.isPrimary ? "true" : "false",
      notes: c.notes || "",
    }));
  },

  async commit(rows, ctx) {
    const db = ctx.db; // ALL commit reads/writes go through ctx.db
    const results: ImportRowResult[] = [];

    const clients = await db.client.findMany({ select: { id: true, name: true } });
    const clientByName = new Map(clients.map((c) => [c.name.toLowerCase(), c.id]));

    // Pre-fetch every contact and bucket it under its natural key. Build
    // this AFTER the client lookup so we can compute the key with the
    // resolved clientId — matching the same logic the per-row code uses.
    const existingContacts = await db.clientContact.findMany({
      select: { id: true, clientId: true, email: true, name: true },
    });
    const existingByKey = new Map<string, { id: string }>(
      existingContacts.map((c) => [
        contactMatchKey(c.clientId, c.email, c.name),
        { id: c.id },
      ])
    );
    const seenInBatch = new Set<string>();

    for (let i = 0; i < rows.length; i++) {
      const rowNumber = i + 1;
      const raw = rows[i];
      const name = (raw.name || "").trim();
      const clientNameRaw = (raw.clientName || "").trim();

      if (!name) {
        results.push({ row: rowNumber, status: "failed", message: "Missing name" });
        continue;
      }
      if (!clientNameRaw) {
        results.push({ row: rowNumber, status: "failed", message: "Missing client name" });
        continue;
      }

      const clientId = clientByName.get(clientNameRaw.toLowerCase());
      if (!clientId) {
        results.push({
          row: rowNumber,
          status: "failed",
          message: `Client not found: "${clientNameRaw}"`,
        });
        continue;
      }

      const isPrimary = parseBool(raw.isPrimary, false);
      const email = raw.email?.trim() || null;
      const key = contactMatchKey(clientId, email, name);

      if (seenInBatch.has(key)) {
        results.push({
          row: rowNumber,
          status: "skipped",
          message: `Duplicate row in file: "${name}" for ${clientNameRaw}`,
        });
        continue;
      }
      seenInBatch.add(key);

      const data = {
        name,
        clientId,
        title: raw.title?.trim() || null,
        email,
        phone: raw.phone?.trim() || null,
        isPrimary,
        notes: raw.notes?.trim() || null,
      };

      const existing = existingByKey.get(key);
      const action = applyMode(existing, ctx.mode);

      try {
        if (action === "update" && existing) {
          let updateData: Partial<typeof data> = data;
          if (ctx.mode === "fill-blanks") {
            const current = await db.clientContact.findUnique({ where: { id: existing.id } });
            updateData = mergeFillBlanks(current, data);
          }
          // Unsetting the previous primary only applies when this
          // update actually writes isPrimary (fill-blanks never flips
          // booleans, so it never steals the primary slot).
          if (isPrimary && updateData.isPrimary === true) {
            await db.clientContact.updateMany({
              where: { clientId, isPrimary: true, NOT: { id: existing.id } },
              data: { isPrimary: false },
            });
          }
          const contact = await db.clientContact.update({
            where: { id: existing.id },
            data: updateData,
          });
          results.push({ row: rowNumber, status: "updated" });
          await logImportActivity(ctx, "imported", "clientContact", contact.id, `${name} (updated)`, {
            clientId,
          });
        } else if (action === "skip") {
          const label = `Contact "${name}" for ${clientNameRaw}`;
          results.push({
            row: rowNumber,
            status: "skipped",
            message: existing ? skipExistsMessage(label) : skipNoMatchMessage(label),
          });
        } else {
          if (isPrimary) {
            await db.clientContact.updateMany({
              where: { clientId, isPrimary: true },
              data: { isPrimary: false },
            });
          }
          const contact = await db.clientContact.create({ data });
          existingByKey.set(key, { id: contact.id });
          results.push({ row: rowNumber, status: "imported" });
          await logImportActivity(ctx, "imported", "clientContact", contact.id, name, {
            clientId,
          });
        }
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
