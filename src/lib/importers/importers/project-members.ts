/**
 * Project members importer — bulk-create or update user-to-project
 * memberships from CSV. Distinct from Assignment (which records FTE /
 * staffing allocation). ProjectMember is the access-control link: which
 * users appear as members on the project page and what their permission
 * role is on it.
 *
 * Required: projectName, employeeEmail
 * Optional: role (Role enum; defaults to CONTRIBUTOR)
 *
 * Upsert match key: (userId + projectId). In create mode, an existing
 * pair is reported as skipped with a clear message. In upsert mode, the
 * row's role is updated to match the CSV (this is the only mutable
 * field on a membership).
 */

import type { Role } from "@prisma/client";
import { db } from "@/lib/db";
import type { ImporterDefinition, ImportRowResult } from "../types";
import {
  applyMode,
  buildResult,
  logImportActivity,
  skipExistsMessage,
  skipNoMatchMessage,
  warnList,
} from "../helpers";

const VALID_ROLES: Role[] = ["GUEST", "VIEWER", "CONTRIBUTOR", "DEVELOPER", "MANAGER", "ADMIN"];

function memberMatchKey(userId: string, projectId: string): string {
  return `${userId}|${projectId}`;
}

export const projectMembersImporter: ImporterDefinition = {
  key: "project-members",
  name: "Project Members",
  description:
    "Bulk-create or update user-to-project memberships (access-control). For staffing/FTE, use the assignments importer instead. Required: projectName, employeeEmail. Optional: role.",
  module: "projects",
  supportsUpsert: true,
  upsertKeyDescription:
    "Matched by (employee email + project name), case-insensitive. Re-uploading the same pair updates the role on the existing membership; in create mode it reports the row as skipped.",

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
    const db = ctx.db; // ALL commit reads/writes go through ctx.db
    const results: ImportRowResult[] = [];

    const projects = await db.project.findMany({ select: { id: true, name: true, clientId: true } });
    const projectByName = new Map(projects.map((p) => [p.name.toLowerCase(), p]));
    const users = await db.user.findMany({
      where: { isActive: true },
      select: { id: true, email: true },
    });
    const userByEmail = new Map(users.map((u) => [u.email.toLowerCase(), u.id]));

    // Pre-fetch every membership keyed by (userId + projectId) for
    // upsert matching and in-batch dedupe.
    const existingMembers = await db.projectMember.findMany({
      select: { id: true, userId: true, projectId: true },
    });
    const existingByKey = new Map<string, { id: string }>(
      existingMembers.map((m) => [memberMatchKey(m.userId, m.projectId), { id: m.id }])
    );
    const seenInBatch = new Set<string>();

    for (let i = 0; i < rows.length; i++) {
      const rowNumber = i + 1;
      const raw = rows[i];
      const warnings: string[] = [];
      const projectNameRaw = (raw.projectName || "").trim();
      const employeeEmail = (raw.employeeEmail || "").trim().toLowerCase();

      if (!projectNameRaw) {
        results.push({ row: rowNumber, status: "failed", message: "Missing projectName" });
        continue;
      }
      if (!employeeEmail) {
        results.push({ row: rowNumber, status: "failed", message: "Missing employeeEmail" });
        continue;
      }

      const project = projectByName.get(projectNameRaw.toLowerCase());
      if (!project) {
        results.push({
          row: rowNumber,
          status: "failed",
          message: `Project not found: "${projectNameRaw}"`,
        });
        continue;
      }

      const userId = userByEmail.get(employeeEmail);
      if (!userId) {
        results.push({
          row: rowNumber,
          status: "failed",
          message: `Employee not found: "${raw.employeeEmail}"`,
        });
        continue;
      }

      const roleInput = (raw.role || "").trim();
      const roleRaw = (roleInput || "CONTRIBUTOR").toUpperCase();
      const role = VALID_ROLES.includes(roleRaw as Role)
        ? (roleRaw as Role)
        : "CONTRIBUTOR";
      if (roleInput && !VALID_ROLES.includes(roleRaw as Role)) {
        warnings.push(`Invalid role "${roleInput}" — defaulted to CONTRIBUTOR`);
      }

      const key = memberMatchKey(userId, project.id);
      if (seenInBatch.has(key)) {
        results.push({
          row: rowNumber,
          status: "skipped",
          message: `Duplicate row in file: ${employeeEmail} on ${projectNameRaw}`,
        });
        continue;
      }
      seenInBatch.add(key);

      const existing = existingByKey.get(key);
      const action = applyMode(existing, ctx.mode);

      try {
        if (action === "update" && existing) {
          // role is the only mutable field on a membership — and it is
          // never blank (enum with a default), so fill-blanks mode is a
          // deliberate no-op update here: existing roles are kept.
          const member =
            ctx.mode === "fill-blanks"
              ? await db.projectMember.update({ where: { id: existing.id }, data: {} })
              : await db.projectMember.update({ where: { id: existing.id }, data: { role } });
          results.push({ row: rowNumber, status: "updated", warnings: warnList(warnings) });
          await logImportActivity(ctx, "imported", "projectMember", member.id, `${employeeEmail} → ${projectNameRaw} (updated)`, {
            projectId: project.id,
            clientId: project.clientId,
          });
        } else if (action === "skip") {
          const label = `Membership ${employeeEmail} on "${projectNameRaw}"`;
          results.push({
            row: rowNumber,
            status: "skipped",
            message: existing ? skipExistsMessage(label) : skipNoMatchMessage(label),
          });
        } else {
          const member = await db.projectMember.create({
            data: { projectId: project.id, userId, role },
          });
          existingByKey.set(key, { id: member.id });
          results.push({ row: rowNumber, status: "imported", warnings: warnList(warnings) });
          await logImportActivity(ctx, "imported", "projectMember", member.id, `${employeeEmail} → ${projectNameRaw}`, {
            projectId: project.id,
            clientId: project.clientId,
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
