/**
 * Project members importer — bulk-create user-to-project memberships
 * from CSV. Distinct from Assignment (which records FTE / staffing
 * allocation). ProjectMember is the access-control link: which users
 * appear as members on the project page and what their permission role
 * is on it.
 *
 * Required: projectName, employeeEmail
 * Optional: role (Role enum; defaults to CONTRIBUTOR)
 *
 * The unique (userId, projectId) constraint means re-running an import
 * with an already-imported pair fails on that row. Treated as a soft
 * "skipped" with a clear message rather than a failure.
 */

import type { Role } from "@prisma/client";
import { db } from "@/lib/db";
import { logActivity } from "@/lib/activity";
import type { ImporterDefinition, ImportRowResult } from "../types";

const VALID_ROLES: Role[] = ["GUEST", "VIEWER", "CONTRIBUTOR", "DEVELOPER", "MANAGER", "ADMIN"];

export const projectMembersImporter: ImporterDefinition = {
  key: "project-members",
  name: "Project Members",
  description:
    "Bulk-create user-to-project memberships (access-control). For staffing/FTE, use the assignments importer instead. Required: projectName, employeeEmail. Optional: role.",
  module: "projects",

  fields: [
    { key: "projectName", label: "Project name", required: true, description: "Must match an existing project by name.", aliases: ["project"] },
    { key: "employeeEmail", label: "Employee email", required: true, description: "Email of an existing active employee.", aliases: ["employee", "user", "member email"] },
    {
      key: "role",
      label: "Role",
      required: false,
      description: "GUEST, VIEWER, CONTRIBUTOR, DEVELOPER, MANAGER, ADMIN. Defaults to CONTRIBUTOR.",
      aliases: ["project role", "access role"],
    },
  ],

  async sampleRows() {
    const members = await db.projectMember.findMany({
      orderBy: { createdAt: "desc" },
      take: 3,
      include: {
        project: { select: { name: true } },
        user: { select: { email: true } },
      },
    });
    return members.map((m) => ({
      projectName: m.project.name,
      employeeEmail: m.user.email,
      role: m.role,
    }));
  },

  async commit(rows, ctx) {
    const results: ImportRowResult[] = [];
    let imported = 0;
    let skipped = 0;
    let failed = 0;

    const projects = await db.project.findMany({ select: { id: true, name: true, clientId: true } });
    const projectByName = new Map(projects.map((p) => [p.name.toLowerCase(), p]));
    const users = await db.user.findMany({
      where: { isActive: true },
      select: { id: true, email: true },
    });
    const userByEmail = new Map(users.map((u) => [u.email.toLowerCase(), u.id]));

    for (let i = 0; i < rows.length; i++) {
      const rowNumber = i + 1;
      const raw = rows[i];
      const projectNameRaw = (raw.projectName || "").trim();
      const employeeEmail = (raw.employeeEmail || "").trim().toLowerCase();

      if (!projectNameRaw) {
        failed++;
        results.push({ row: rowNumber, status: "failed", message: "Missing projectName" });
        continue;
      }
      if (!employeeEmail) {
        failed++;
        results.push({ row: rowNumber, status: "failed", message: "Missing employeeEmail" });
        continue;
      }

      const project = projectByName.get(projectNameRaw.toLowerCase());
      if (!project) {
        failed++;
        results.push({
          row: rowNumber,
          status: "failed",
          message: `Project not found: "${projectNameRaw}"`,
        });
        continue;
      }

      const userId = userByEmail.get(employeeEmail);
      if (!userId) {
        failed++;
        results.push({
          row: rowNumber,
          status: "failed",
          message: `Employee not found: "${raw.employeeEmail}"`,
        });
        continue;
      }

      const roleRaw = (raw.role || "CONTRIBUTOR").trim().toUpperCase();
      const role = VALID_ROLES.includes(roleRaw as Role)
        ? (roleRaw as Role)
        : "CONTRIBUTOR";

      try {
        const member = await db.projectMember.create({
          data: { projectId: project.id, userId, role },
        });
        imported++;
        results.push({ row: rowNumber, status: "imported" });
        await logActivity("imported", "projectMember", member.id, ctx.triggeredBy, `${employeeEmail} → ${projectNameRaw}`, {
          projectId: project.id,
          clientId: project.clientId,
        });
      } catch (err) {
        // Unique constraint violation on (userId, projectId) → already a member
        const msg = err instanceof Error ? err.message : "DB error";
        if (msg.includes("Unique constraint")) {
          skipped++;
          results.push({
            row: rowNumber,
            status: "skipped",
            message: `Already a member of "${projectNameRaw}"`,
          });
        } else {
          failed++;
          results.push({ row: rowNumber, status: "failed", message: msg });
        }
      }
    }

    return { imported, skipped, failed, rows: results };
  },
};
