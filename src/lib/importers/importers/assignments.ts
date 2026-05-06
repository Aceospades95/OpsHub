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

/** Build the natural-key string used for upsert matching. (employeeId +
 *  projectId + roleDefinitionId) — same employee on the same project in
 *  the same role definition is treated as the same staffing record. The
 *  ids may be empty strings for unscoped (bench) or freeform-role
 *  assignments, which collapse all such rows for the employee into a
 *  single bucket. */
function assignmentMatchKey(
  employeeId: string,
  projectId: string | null,
  roleDefinitionId: string | null
): string {
  return `${employeeId}|${projectId || ""}|${roleDefinitionId || ""}`;
}

export const assignmentsImporter: ImporterDefinition = {
  key: "assignments",
  name: "Assignments",
  description:
    "Bulk-create or update staffing assignments. Required: employeeEmail. Optional: project, client, service offering, role, FTE, dates, status.",
  module: "team",
  supportsUpsert: true,
  upsertKeyDescription:
    "Matched by (employee email + project + role definition), all case-insensitive. Re-uploading the same employee on the same project in the same role updates the existing assignment instead of stacking duplicates.",

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
    let updated = 0;
    let skipped = 0;
    let failed = 0;
    const upsert = ctx.mode === "upsert";

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

    // Pre-fetch every assignment keyed by (employeeId + projectId +
    // roleDefinitionId) for upsert matching and in-batch dedupe. Built
    // here AFTER the FK lookups so the natural key uses the same ids
    // the per-row code resolves below.
    const existingAssignments = await db.assignment.findMany({
      select: {
        id: true,
        employeeId: true,
        projectId: true,
        roleDefinitionId: true,
      },
    });
    const existingByKey = new Map<string, { id: string }>(
      existingAssignments.map((a) => [
        assignmentMatchKey(a.employeeId, a.projectId, a.roleDefinitionId),
        { id: a.id },
      ])
    );
    const seenInBatch = new Set<string>();

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

      const key = assignmentMatchKey(employeeId, projectId, roleDefinitionId);
      if (seenInBatch.has(key)) {
        skipped++;
        results.push({
          row: rowNumber,
          status: "skipped",
          message: `Duplicate row in file: ${employeeEmail}${raw.projectName ? ` on ${raw.projectName}` : ""}${raw.roleDefinitionName ? ` as ${raw.roleDefinitionName}` : ""}`,
        });
        continue;
      }
      seenInBatch.add(key);

      const data = {
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
      };

      const existing = existingByKey.get(key);

      try {
        if (existing && upsert) {
          const assignment = await db.assignment.update({
            where: { id: existing.id },
            data,
          });
          updated++;
          results.push({ row: rowNumber, status: "updated" });
          await logActivity(
            "imported",
            "assignment",
            assignment.id,
            ctx.triggeredBy,
            `Assignment for ${employeeEmail} (updated)`,
            { projectId: assignment.projectId, clientId: assignment.clientId }
          );
        } else if (existing && !upsert) {
          skipped++;
          results.push({
            row: rowNumber,
            status: "skipped",
            message: `Assignment already exists: ${employeeEmail}${raw.projectName ? ` on ${raw.projectName}` : ""}${raw.roleDefinitionName ? ` as ${raw.roleDefinitionName}` : ""}. Re-run with "Update existing rows" enabled to update it.`,
          });
        } else {
          const assignment = await db.assignment.create({ data });
          existingByKey.set(key, { id: assignment.id });
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
