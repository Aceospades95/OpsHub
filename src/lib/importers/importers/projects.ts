/**
 * Projects importer — bulk-create projects from CSV.
 *
 * Required: name, clientName
 * Optional: status, description, startDate, endDate, serviceOfferingName,
 *           parentProjectName
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

function formatDate(d: Date | null | undefined): string {
  return d ? d.toISOString().slice(0, 10) : "";
}

export const projectsImporter: ImporterDefinition = {
  key: "projects",
  name: "Projects",
  description:
    "Bulk-create or update projects. Required: name, clientName. Optional: status, dates, service offering.",
  module: "projects",
  supportsUpsert: true,
  upsertKeyDescription:
    "Matched by (client + project name). Two projects on the same client with the same name are treated as the same row on re-upload.",

  fields: [
    { key: "name", label: "Project name", required: true, aliases: ["project", "project name", "title"] },
    { key: "clientName", label: "Client name", required: true, description: "Must match an existing client by name.", aliases: ["client", "company", "account"] },
    { key: "status", label: "Status", required: false, description: "PLANNING, ACTIVE, ON_HOLD, COMPLETED, ARCHIVED. Defaults to PLANNING.", aliases: ["project status"] },
    { key: "description", label: "Description", required: false, aliases: ["notes", "summary"] },
    { key: "startDate", label: "Start date", required: false, aliases: ["start", "kick off", "kickoff"] },
    { key: "endDate", label: "End date", required: false, aliases: ["end", "target date", "deadline"] },
    { key: "serviceOfferingName", label: "Service offering", required: false, description: "Name of an existing service offering (matched by name).", aliases: ["offering", "service", "service offering"] },
    {
      key: "parentProjectName",
      label: "Parent project",
      required: false,
      description: "Name of an existing project to nest this one under. Matches case-insensitively against projects in the same client when ambiguous.",
      aliases: ["parent project", "parent", "parent name"],
    },
  ],

  async sampleRows() {
    const projects = await db.project.findMany({
      orderBy: { createdAt: "desc" },
      take: 3,
      include: {
        client: { select: { name: true } },
        serviceOffering: { select: { name: true } },
        parentProject: { select: { name: true } },
      },
    });
    return projects.map((p) => ({
      name: p.name,
      clientName: p.client.name,
      status: p.status,
      description: p.description || "",
      startDate: formatDate(p.startDate),
      endDate: formatDate(p.endDate),
      serviceOfferingName: p.serviceOffering?.name || "",
      parentProjectName: p.parentProject?.name || "",
    }));
  },

  async commit(rows, ctx) {
    const results: ImportRowResult[] = [];
    let imported = 0, updated = 0, skipped = 0, failed = 0;
    const upsert = ctx.mode === "upsert";

    const clients = await db.client.findMany({ select: { id: true, name: true } });
    const clientByName = new Map(clients.map((c) => [c.name.toLowerCase(), c.id]));
    const offerings = await db.serviceOffering.findMany({ where: { isActive: true }, select: { id: true, name: true } });
    const offeringByName = new Map(offerings.map((o) => [o.name.toLowerCase(), o.id]));
    // Pre-fetch every existing project so parent-by-name lookups don't
    // round-trip per row. Disambiguate by client when the same name exists
    // under multiple clients; if it exists under only one client, accept it.
    const existingProjects = await db.project.findMany({
      select: { id: true, name: true, clientId: true },
    });
    const projectsByNameAndClient = new Map<string, string>(); // `${nameLower}|${clientId}` -> projectId
    const projectsByNameUnique = new Map<string, string | null>(); // nameLower -> projectId, or null if ambiguous
    for (const p of existingProjects) {
      projectsByNameAndClient.set(`${p.name.toLowerCase()}|${p.clientId}`, p.id);
      const key = p.name.toLowerCase();
      if (!projectsByNameUnique.has(key)) {
        projectsByNameUnique.set(key, p.id);
      } else {
        projectsByNameUnique.set(key, null); // ambiguous
      }
    }

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

      // Resolve parent project: prefer (parentName + same client). If not
      // found there, fall back to a globally unique name match. Ambiguous
      // names produce a soft-skip on the link (row still imports).
      const parentNameRaw = (raw.parentProjectName || "").trim().toLowerCase();
      let parentProjectId: string | null = null;
      if (parentNameRaw) {
        parentProjectId =
          projectsByNameAndClient.get(`${parentNameRaw}|${clientId}`) ||
          projectsByNameUnique.get(parentNameRaw) ||
          null;
      }

      // Match existing by (client + lowercased name). This is the
      // natural key for projects — same client + same name means the
      // same project, even if the user re-uploaded the file.
      const matchKey = `${name.toLowerCase()}|${clientId}`;
      const existingId = projectsByNameAndClient.get(matchKey) || null;

      const data = {
        name,
        clientId,
        status,
        description: raw.description?.trim() || null,
        startDate: parseDate(raw.startDate),
        endDate: parseDate(raw.endDate),
        serviceOfferingId,
        parentProjectId,
      };

      try {
        if (existingId && upsert) {
          const project = await db.project.update({ where: { id: existingId }, data });
          updated++; results.push({ row: rowNumber, status: "updated" });
          await logActivity("imported", "project", project.id, ctx.triggeredBy, `${name} (updated)`, {
            projectId: project.id, clientId: project.clientId,
          });
        } else if (existingId && !upsert) {
          results.push({
            row: rowNumber,
            status: "skipped",
            message: `Already exists for client "${clientNameRaw}". Re-run with "Update existing rows" enabled to update it.`,
          });
        } else {
          const project = await db.project.create({ data });
          imported++; results.push({ row: rowNumber, status: "imported" });
          await logActivity("imported", "project", project.id, ctx.triggeredBy, name, {
            projectId: project.id, clientId: project.clientId,
          });
          projectsByNameAndClient.set(matchKey, project.id);
          const ukey = name.toLowerCase();
          if (!projectsByNameUnique.has(ukey)) {
            projectsByNameUnique.set(ukey, project.id);
          } else {
            projectsByNameUnique.set(ukey, null);
          }
        }
      } catch (err) {
        failed++; results.push({ row: rowNumber, status: "failed", message: err instanceof Error ? err.message : "DB error" });
      }
    }

    const skippedTotal = results.filter((r) => r.status === "skipped").length;
    return { imported, updated, skipped: skipped + skippedTotal, failed, rows: results };
  },

  async exportRows() {
    const projects = await db.project.findMany({
      orderBy: { updatedAt: "desc" },
      include: {
        client: { select: { name: true } },
        serviceOffering: { select: { name: true } },
        parentProject: { select: { name: true } },
      },
    });
    return projects.map((p) => ({
      name: p.name,
      clientName: p.client.name,
      status: p.status,
      description: p.description || "",
      startDate: formatDate(p.startDate),
      endDate: formatDate(p.endDate),
      serviceOfferingName: p.serviceOffering?.name || "",
      parentProjectName: p.parentProject?.name || "",
    }));
  },
};
