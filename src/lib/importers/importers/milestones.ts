/**
 * Milestones importer — bulk-create project milestones from CSV.
 *
 * Required: projectName, title
 * Optional: description, dueDate, completed, completedAt, assigneeEmails
 *
 * The project is matched by name. assigneeEmails accepts a comma- or
 * pipe-separated list of employee emails; each is resolved against the
 * active user table and gets a MilestoneAssignee row. Unknown emails
 * are silently skipped (the milestone still imports) so a stale roster
 * doesn't fail the row.
 */

import { db } from "@/lib/db";
import { logActivity } from "@/lib/activity";
import type { ImporterDefinition, ImportRowResult } from "../types";

function parseDate(v: string | undefined): Date | null {
  if (!v || v.trim() === "") return null;
  const d = new Date(v.trim());
  return isNaN(d.getTime()) ? null : d;
}

function formatDate(d: Date | null | undefined): string {
  return d ? d.toISOString().slice(0, 10) : "";
}

function parseBool(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined || value === "") return defaultValue;
  const v = value.trim().toLowerCase();
  if (["false", "no", "0", "off"].includes(v)) return false;
  if (["true", "yes", "1", "on"].includes(v)) return true;
  return defaultValue;
}

function splitList(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(/[,|]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export const milestonesImporter: ImporterDefinition = {
  key: "milestones",
  name: "Milestones",
  description:
    "Bulk-create project milestones. Required: projectName, title. Optional: description, dueDate, completed flag, completion date, comma- or pipe-separated assignee emails.",
  module: "projects",

  fields: [
    { key: "projectName", label: "Project name", required: true, description: "Must match an existing project by name.", aliases: ["project"] },
    { key: "title", label: "Title", required: true, aliases: ["milestone", "name"] },
    { key: "description", label: "Description", required: false, aliases: ["notes", "details"] },
    { key: "dueDate", label: "Due date", required: false, aliases: ["due", "deadline", "target date"] },
    {
      key: "completed",
      label: "Completed",
      required: false,
      description: "true / false. Defaults to false. Set to true when migrating an already-finished milestone.",
      aliases: ["done", "finished"],
    },
    {
      key: "completedAt",
      label: "Completed at",
      required: false,
      description: "Date the milestone was completed. Auto-set to today when completed=true and this is blank.",
      aliases: ["completion date", "done at"],
    },
    {
      key: "assigneeEmails",
      label: "Assignee emails",
      required: false,
      description: "Comma- or pipe-separated list of employee emails. Each one becomes a MilestoneAssignee.",
      aliases: ["assignees", "owners", "responsible"],
    },
  ],

  async sampleRows() {
    const milestones = await db.milestone.findMany({
      orderBy: { createdAt: "desc" },
      take: 3,
      include: {
        project: { select: { name: true } },
        assignees: { include: { user: { select: { email: true } } } },
      },
    });
    return milestones.map((m) => ({
      projectName: m.project.name,
      title: m.title,
      description: m.description || "",
      dueDate: formatDate(m.dueDate),
      completed: m.completed ? "true" : "false",
      completedAt: formatDate(m.completedAt),
      assigneeEmails: m.assignees.map((a) => a.user.email).join("|"),
    }));
  },

  async commit(rows, ctx) {
    const results: ImportRowResult[] = [];
    let imported = 0;
    const skipped = 0;
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
      const title = (raw.title || "").trim();

      if (!projectNameRaw) {
        failed++;
        results.push({ row: rowNumber, status: "failed", message: "Missing projectName" });
        continue;
      }
      if (!title) {
        failed++;
        results.push({ row: rowNumber, status: "failed", message: "Missing title" });
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

      const completed = parseBool(raw.completed, false);
      const completedAtRaw = parseDate(raw.completedAt);
      const completedAt =
        completedAtRaw ?? (completed ? new Date() : null);

      const assigneeEmails = splitList(raw.assigneeEmails).map((e) => e.toLowerCase());

      try {
        const milestone = await db.milestone.create({
          data: {
            projectId: project.id,
            title,
            description: raw.description?.trim() || null,
            dueDate: parseDate(raw.dueDate),
            completed,
            completedAt,
          },
        });

        if (assigneeEmails.length > 0) {
          const seen = new Set<string>();
          for (const email of assigneeEmails) {
            const userId = userByEmail.get(email);
            if (!userId || seen.has(userId)) continue;
            seen.add(userId);
            // Best-effort: skip duplicates from the unique([milestoneId,userId])
            // constraint silently rather than failing the row.
            await db.milestoneAssignee
              .create({ data: { milestoneId: milestone.id, userId } })
              .catch(() => {});
          }
        }

        imported++;
        results.push({ row: rowNumber, status: "imported" });
        await logActivity("imported", "milestone", milestone.id, ctx.triggeredBy, title, {
          projectId: project.id,
          clientId: project.clientId,
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

    return { imported, skipped, failed, rows: results };
  },
};
