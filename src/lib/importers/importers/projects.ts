/**
 * Projects importer — bulk-create projects from CSV.
 *
 * Required: name, clientName
 * Optional: status, description, startDate, endDate, serviceOfferingName
 */

import type { ProjectStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { logActivity } from "@/lib/activity";
import type { ImporterDefinition, ImportResult, ImportRowResult } from "../types";

const VALID_STATUSES: ProjectStatus[] = [
  "PLANNING", "ACTIVE", "ON_HOLD", "COMPLETED", "ARCHIVED",
];

function parseDate(v: string | undefined): Date | null {
  if (!v || v.trim() === "") return null;
  const d = new Date(v.trim());
  return isNaN(d.getTime()) ? null : d;
}

export const projectsImporter: ImporterDefinition = {
  key: "projects",
  name: "Projects",
  description:
    "Bulk-create projects. Required: name, clientName. Optional: status, dates, service offering.",
  module: "projects",

  fields: [
    { key: "name", label: "Project name", required: true, aliases: ["project", "project name", "title"] },
    { key: "clientName", label: "Client name", required: true, description: "Must match an existing client by name.", aliases: ["client", "company", "account"] },
    { key: "status", label: "Status", required: false, description: "PLANNING, ACTIVE, ON_HOLD, COMPLETED, ARCHIVED. Defaults to PLANNING.", aliases: ["project status"] },
    { key: "description", label: "Description", required: false, aliases: ["notes", "summary"] },
    { key: "startDate", label: "Start date", required: false, aliases: ["start", "kick off", "kickoff"] },
    { key: "endDate", label: "End date", required: false, aliases: ["end", "target date", "deadline"] },
    { key: "serviceOfferingName", label: "Service offering", required: false, description: "Name of an existing service offering (matched by name).", aliases: ["offering", "service", "service offering"] },
  ],

  async commit(rows, ctx) {
    const results: ImportRowResult[] = [];
    let imported = 0, skipped = 0, failed = 0;

    const clients = await db.client.findMany({ select: { id: true, name: true } });
    const clientByName = new Map(clients.map((c) => [c.name.toLowerCase(), c.id]));
    const offerings = await db.serviceOffering.findMany({ where: { isActive: true }, select: { id: true, name: true } });
    const offeringByName = new Map(offerings.map((o) => [o.name.toLowerCase(), o.id]));

    for (let i = 0; i < rows.length; i++) {
      const rowNumber = i + 1;
      const raw = rows[i];
      const name = (raw.name || "").trim();
      const clientNameRaw = (raw.clientName || "").trim();

      if (!name) { failed++; results.push({ row: rowNumber, status: "failed", message: "Missing name" }); continue; }
      if (!clientNameRaw) { failed++; results.push({ row: rowNumber, status: "failed", message: "Missing client name" }); continue; }

      const clientId = clientByName.get(clientNameRaw.toLowerCase());
      if (!clientId) { failed++; results.push({ row: rowNumber, status: "failed", message: `Client not found: "${clientNameRaw}"` }); continue; }

      const statusRaw = (raw.status || "PLANNING").trim().toUpperCase();
      const status = VALID_STATUSES.includes(statusRaw as ProjectStatus) ? (statusRaw as ProjectStatus) : null;
      if (!status) { failed++; results.push({ row: rowNumber, status: "failed", message: `Invalid status "${raw.status}"` }); continue; }

      const offeringName = (raw.serviceOfferingName || "").trim().toLowerCase();
      const serviceOfferingId = offeringName ? offeringByName.get(offeringName) || null : null;

      try {
        const project = await db.project.create({
          data: {
            name,
            clientId,
            status,
            description: raw.description?.trim() || null,
            startDate: parseDate(raw.startDate),
            endDate: parseDate(raw.endDate),
            serviceOfferingId,
          },
        });
        imported++; results.push({ row: rowNumber, status: "imported" });
        await logActivity("imported", "project", project.id, ctx.triggeredBy, name);
      } catch (err) {
        failed++; results.push({ row: rowNumber, status: "failed", message: err instanceof Error ? err.message : "DB error" });
      }
    }

    return { imported, skipped, failed, rows: results };
  },
};
