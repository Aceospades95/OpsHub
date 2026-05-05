/**
 * Assignments importer — bulk-create staffing assignments from CSV.
 *
 * Required: employeeEmail
 * Optional: projectName, clientName, serviceOfferingName, role,
 *           function, allocationFte, status, startDate, endDate, notes
 *
 * Either projectName or clientName (or neither — bench / general
 * allocation) is supported. Service offering and role definition lookups
 * are case-insensitive against the live tables. Auto-promotion of the
 * employee's role is intentionally NOT triggered here since imports
 * are admin-driven and bulk; admins can run the existing role audit
 * tools afterwards if needed.
 */

import type { AssignmentStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { logActivity } from "@/lib/activity";
import type { ImporterDefinition, ImportRowResult } from "../types";

const VALID_STATUSES: AssignmentStatus[] = ["ACTIVE", "PLANNED", "COMPLETED", "ON_HOLD"];

function parseDate(v: string | undefined): Date | null {
  if (!v || v.trim() === "") return null;
  const d = new Date(v.trim());
  return isNaN(d.getTime()) ? null : d;
}

function formatDate(d: Date | null | undefined): string {
  return d ? d.toISOString().slice(0, 10) : "";
}

export const assignmentsImporter: ImporterDefinition = {
  key: "assignments",
  name: "Assignments",
  description:
    "Bulk-create staffing assignments. Required: employeeEmail. Optional: project, client, service offering, role, FTE, dates, status.",
  module: "team",

  fields: [
    {
      key: "employeeEmail",
      label: "Employee email",
      required: true,
      description: "Email of an existing active employee.",
      aliases: ["employee", "person", "user", "email"],
    },
    {
      key: "projectName",
      label: "Project name",
      required: false,
      description: "Optional: scope to an existing project (matched by name).",
      aliases: ["project"],
    },
    {
      key: "clientName",
      label: "Client name",
      required: false,
      description: "Optional: scope to an existing client (matched by name).",
      aliases: ["client", "company"],
    },
    {
      key: "serviceOfferingName",
      label: "Service offering",
      required: false,
      description: "Optional: name of an existing service offering.",
      aliases: ["offering", "service"],
    },
    {
      key: "roleDefinitionName",
      label: "Role definition",
      required: false,
      description: "Optional: name of an existing role definition.",
      aliases: ["role definition", "role def"],
    },
    {
      key: "role",
      label: "Role (freeform)",
      required: false,
      description: "Legacy freeform role label; prefer roleDefinitionName when possible.",
      aliases: ["role label", "title"],
    },
    {
      key: "function",
      label: "Function",
      required: false,
      description: "Functional area / type of work.",
      aliases: ["work type", "functional area"],
    },
    {
      key: "allocationFte",
      label: "Allocation FTE",
      required: false,
      description: "Decimal between 0 and 2. Defaults to 0.",
      aliases: ["fte", "allocation"],
    },
    {
      key: "status",
      label: "Status",
      required: false,
      description: "ACTIVE, PLANNED, COMPLETED, ON_HOLD. Defaults to ACTIVE.",
      aliases: ["assignment status"],
    },
    { key: "startDate", label: "Start date", required: false, aliases: ["start"] },
    { key: "endDate", label: "End date", required: false, aliases: ["end"] },
    { key: "notes", label: "Notes", required: false, aliases: ["comments"] },
  ],

  async sampleRows() {
    const assignments = await db.assignment.findMany({
      orderBy: { createdAt: "desc" },
      take: 3,
      include: {
        employee: { select: { email: true } },
        project: { select: { name: true } },
        client: { select: { name: true } },
        serviceOffering: { select: { name: true } },
        roleDefinition: { select: { name: true } },
      },
    });
    return assignments.map((a) => ({
      employeeEmail: a.employee.email,
      projectName: a.project?.name || "",
      clientName: a.client?.name || "",
      serviceOfferingName: a.serviceOffering?.name || "",
      roleDefinitionName: a.roleDefinition?.name || "",
      role: a.role || "",
      function: a.function || "",
      allocationFte: String(a.allocationFte),
      status: a.status,
      startDate: formatDate(a.startDate),
      endDate: formatDate(a.endDate),
      notes: a.notes || "",
    }));
  },

  async commit(rows, ctx) {
    const results: ImportRowResult[] = [];
    let imported = 0;
    const skipped = 0;
    let failed = 0;

    const users = await db.user.findMany({
      where: { isActive: true },
      select: { id: true, email: true },
    });
    const userByEmail = new Map(users.map((u) => [u.email.toLowerCase(), u.id]));
    const projects = await db.project.findMany({ select: { id: true, name: true } });
    const projectByName = new Map(projects.map((p) => [p.name.toLowerCase(), p.id]));
    const clients = await db.client.findMany({ select: { id: true, name: true } });
    const clientByName = new Map(clients.map((c) => [c.name.toLowerCase(), c.id]));
    const offerings = await db.serviceOffering.findMany({
      where: { isActive: true },
      select: { id: true, name: true },
    });
    const offeringByName = new Map(offerings.map((o) => [o.name.toLowerCase(), o.id]));
    const roleDefs = await db.roleDefinition.findMany({ select: { id: true, name: true } });
    const roleDefByName = new Map(roleDefs.map((r) => [r.name.toLowerCase(), r.id]));
    // Auto-link to a ProjectRole row when the assignment's (project,
    // roleDefinition) pair matches a defined slot. Indexed by
    // `${projectId}|${roleDefinitionId}` for O(1) lookup per row.
    const projectRoles = await db.projectRole.findMany({
      select: { id: true, projectId: true, roleDefinitionId: true },
    });
    const projectRoleByProjectAndDef = new Map(
      projectRoles.map((pr) => [`${pr.projectId}|${pr.roleDefinitionId}`, pr.id])
    );

    for (let i = 0; i < rows.length; i++) {
      const rowNumber = i + 1;
      const raw = rows[i];
      const employeeEmail = (raw.employeeEmail || "").trim().toLowerCase();
      if (!employeeEmail) {
        failed++;
        results.push({ row: rowNumber, status: "failed", message: "Missing employeeEmail" });
        continue;
      }
      const employeeId = userByEmail.get(employeeEmail);
      if (!employeeId) {
        failed++;
        results.push({
          row: rowNumber,
          status: "failed",
          message: `Employee not found: "${raw.employeeEmail}"`,
        });
        continue;
      }

      const statusRaw = (raw.status || "ACTIVE").trim().toUpperCase();
      const status = VALID_STATUSES.includes(statusRaw as AssignmentStatus)
        ? (statusRaw as AssignmentStatus)
        : null;
      if (!status) {
        failed++;
        results.push({ row: rowNumber, status: "failed", message: `Invalid status "${raw.status}"` });
        continue;
      }

      const projectName = (raw.projectName || "").trim().toLowerCase();
      const projectId = projectName ? projectByName.get(projectName) || null : null;
      const clientName = (raw.clientName || "").trim().toLowerCase();
      const clientId = clientName ? clientByName.get(clientName) || null : null;
      const offeringName = (raw.serviceOfferingName || "").trim().toLowerCase();
      const serviceOfferingId = offeringName ? offeringByName.get(offeringName) || null : null;
      const roleDefName = (raw.roleDefinitionName || "").trim().toLowerCase();
      const roleDefinitionId = roleDefName ? roleDefByName.get(roleDefName) || null : null;

      // If both a project and a role definition resolve, see if a
      // ProjectRole slot exists for that pair. Linking the assignment
      // there means it shows up in the staffing matrix's role columns.
      const projectRoleId =
        projectId && roleDefinitionId
          ? projectRoleByProjectAndDef.get(`${projectId}|${roleDefinitionId}`) || null
          : null;

      const allocationRaw = (raw.allocationFte || "").trim();
      const allocationFte = allocationRaw ? parseFloat(allocationRaw) || 0 : 0;
      if (allocationFte < 0 || allocationFte > 2) {
        failed++;
        results.push({
          row: rowNumber,
          status: "failed",
          message: `allocationFte must be between 0 and 2`,
        });
        continue;
      }

      try {
        const assignment = await db.assignment.create({
          data: {
            employeeId,
            projectId,
            clientId,
            serviceOfferingId,
            roleDefinitionId,
            projectRoleId,
            role: raw.role?.trim() || null,
            function: raw.function?.trim() || null,
            allocationFte,
            status,
            startDate: parseDate(raw.startDate),
            endDate: parseDate(raw.endDate),
            notes: raw.notes?.trim() || null,
          },
        });
        imported++;
        results.push({ row: rowNumber, status: "imported" });
        await logActivity(
          "imported",
          "assignment",
          assignment.id,
          ctx.triggeredBy,
          `Assignment for ${employeeEmail}`,
          { projectId: assignment.projectId, clientId: assignment.clientId }
        );
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
