/**
 * Client contacts importer — bulk-create per-client contact rows from CSV.
 *
 * Required: name, clientName
 * Optional: title, email, phone, isPrimary, notes
 *
 * When isPrimary=true, any existing primary contact on the same client is
 * unset (matches the createContact server action behavior).
 */

import { db } from "@/lib/db";
import { logActivity } from "@/lib/activity";
import type { ImporterDefinition, ImportRowResult } from "../types";

function parseBool(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined || value === "") return defaultValue;
  const v = value.trim().toLowerCase();
  if (["false", "no", "0", "off"].includes(v)) return false;
  if (["true", "yes", "1", "on"].includes(v)) return true;
  return defaultValue;
}

export const clientContactsImporter: ImporterDefinition = {
  key: "client-contacts",
  name: "Client Contacts",
  description:
    "Bulk-create per-client contacts. Required: name, clientName. Optional: title, email, phone, isPrimary, notes.",
  module: "clients",

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
    const results: ImportRowResult[] = [];
    let imported = 0;
    const skipped = 0;
    let failed = 0;

    const clients = await db.client.findMany({ select: { id: true, name: true } });
    const clientByName = new Map(clients.map((c) => [c.name.toLowerCase(), c.id]));

    for (let i = 0; i < rows.length; i++) {
      const rowNumber = i + 1;
      const raw = rows[i];
      const name = (raw.name || "").trim();
      const clientNameRaw = (raw.clientName || "").trim();

      if (!name) {
        failed++;
        results.push({ row: rowNumber, status: "failed", message: "Missing name" });
        continue;
      }
      if (!clientNameRaw) {
        failed++;
        results.push({ row: rowNumber, status: "failed", message: "Missing client name" });
        continue;
      }

      const clientId = clientByName.get(clientNameRaw.toLowerCase());
      if (!clientId) {
        failed++;
        results.push({
          row: rowNumber,
          status: "failed",
          message: `Client not found: "${clientNameRaw}"`,
        });
        continue;
      }

      const isPrimary = parseBool(raw.isPrimary, false);

      try {
        if (isPrimary) {
          await db.clientContact.updateMany({
            where: { clientId, isPrimary: true },
            data: { isPrimary: false },
          });
        }
        const contact = await db.clientContact.create({
          data: {
            name,
            clientId,
            title: raw.title?.trim() || null,
            email: raw.email?.trim() || null,
            phone: raw.phone?.trim() || null,
            isPrimary,
            notes: raw.notes?.trim() || null,
          },
        });
        imported++;
        results.push({ row: rowNumber, status: "imported" });
        await logActivity("imported", "clientContact", contact.id, ctx.triggeredBy, name, {
          clientId,
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
