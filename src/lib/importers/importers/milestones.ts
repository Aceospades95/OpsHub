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
import type { ImporterDefinition, ImportRowResult } from "../types";
import {
  applyMode,
  buildResult,
  logImportActivity,
  mergeFillBlanks,
  skipExistsMessage,
  skipNoMatchMessage,
  warnList,
} from "../helpers";

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

/** Build the natural-key string used for upsert matching. (projectId +
 *  title) lowercased — the same milestone title can live under multiple
 *  projects, but is unique within one. */
function milestoneMatchKey(projectId: string, title: string): string {
  return `${projectId}|${title.trim().toLowerCase()}`;
}

export const milestonesImporter: ImporterDefinition = {
  key: "milestones",
  name: "Milestones",
  description:
    "Bulk-create or update project milestones. Required: projectName, title. Optional: description, dueDate, completed flag, completion date, comma- or pipe-separated assignee emails.",
  module: "projects",
  supportsUpsert: true,
  upsertKeyDescription:
    "Matched by (project + title), case-insensitive on title. Re-uploading the same title under the same project updates the existing milestone. In upsert mode the assignee list is replaced (not merged) so the CSV is the source of truth.",

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
    const db = ctx.db; // ALL commit reads/writes go through ctx.db
    const results: ImportRowResult[] = [];

    const projects = await db.project.findMany({ select: { id: true, name: true, clientId: true } });
    const projectByName = new Map(projects.map((p) => [p.name.toLowerCase(), p]));
    const users = await db.user.findMany({
      where: { isActive: true },
      select: { id: true, email: true },
    });
    const userByEmail = new Map(users.map((u) => [u.email.toLowerCase(), u.id]));

    // Pre-fetch every milestone keyed by (projectId + lowercased title)
    // for upsert matching and in-batch dedupe.
    const existingMilestones = await db.milestone.findMany({
      select: { id: true, title: true, projectId: true },
    });
    const existingByKey = new Map<string, { id: string }>(
      existingMilestones.map((m) => [milestoneMatchKey(m.projectId, m.title), { id: m.id }])
    );
    const seenInBatch = new Set<string>();

    for (let i = 0; i < rows.length; i++) {
      const rowNumber = i + 1;
      const raw = rows[i];
      const warnings: string[] = [];
      const projectNameRaw = (raw.projectName || "").trim();
      const title = (raw.title || "").trim();

      if (!projectNameRaw) {
        results.push({ row: rowNumber, status: "failed", message: "Missing projectName" });
        continue;
      }
      if (!title) {
        results.push({ row: rowNumber, status: "failed", message: "Missing title" });
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

      const completed = parseBool(raw.completed, false);
      const completedAtRaw = parseDate(raw.completedAt);
      const completedAt =
        completedAtRaw ?? (completed ? new Date() : null);

      const assigneeEmails = splitList(raw.assigneeEmails).map((e) => e.toLowerCase());
      const unresolvedAssignees = assigneeEmails.filter((e) => !userByEmail.has(e));
      if (unresolvedAssignees.length > 0) {
        warnings.push(
          `Assignee${unresolvedAssignees.length === 1 ? "" : "s"} not found: ${unresolvedAssignees.map((e) => `"${e}"`).join(", ")} — skipped on this milestone`
        );
      }

      const key = milestoneMatchKey(project.id, title);
      if (seenInBatch.has(key)) {
        results.push({
          row: rowNumber,
          status: "skipped",
          message: `Duplicate row in file: "${title}" in ${projectNameRaw}`,
        });
        continue;
      }
      seenInBatch.add(key);

      const data = {
        projectId: project.id,
        title,
        description: raw.description?.trim() || null,
        dueDate: parseDate(raw.dueDate),
        completed,
        completedAt,
      };

      const existing = existingByKey.get(key);
      const action = applyMode(existing, ctx.mode);

      /** Resolve and write the milestone's assignees. Used by both the
       *  create and update branches; the update branch wipes the
       *  existing rows first so the CSV is authoritative. */
      const writeAssignees = async (milestoneId: string) => {
        if (assigneeEmails.length === 0) return;
        const seen = new Set<string>();
        for (const email of assigneeEmails) {
          const userId = userByEmail.get(email);
          if (!userId || seen.has(userId)) continue;
          seen.add(userId);
          await db.milestoneAssignee
            .create({ data: { milestoneId, userId } })
            .catch(() => {});
        }
      };

      try {
        if (action === "update" && existing) {
          let updateData: Partial<typeof data> = data;
          if (ctx.mode === "fill-blanks") {
            const current = await db.milestone.findUnique({ where: { id: existing.id } });
            updateData = mergeFillBlanks(current, data);
          }
          const milestone = await db.milestone.update({
            where: { id: existing.id },
            data: updateData,
          });
          // Replace the assignee set when the CSV row provides one.
          // Empty cells leave the existing list alone — the rule is
          // "non-empty wins". In fill-blanks mode the CSV list only
          // lands when the milestone has no assignees yet.
          if (assigneeEmails.length > 0) {
            if (ctx.mode === "fill-blanks") {
              const assigneeCount = await db.milestoneAssignee.count({
                where: { milestoneId: milestone.id },
              });
              if (assigneeCount === 0) {
                await writeAssignees(milestone.id);
              }
            } else {
              await db.milestoneAssignee.deleteMany({ where: { milestoneId: milestone.id } });
              await writeAssignees(milestone.id);
            }
          }
          results.push({ row: rowNumber, status: "updated", warnings: warnList(warnings) });
          await logImportActivity(ctx, "imported", "milestone", milestone.id, `${title} (updated)`, {
            projectId: project.id,
            clientId: project.clientId,
          });
        } else if (action === "skip") {
          const label = `Milestone "${title}" in ${projectNameRaw}`;
          results.push({
            row: rowNumber,
            status: "skipped",
            message: existing ? skipExistsMessage(label) : skipNoMatchMessage(label),
          });
        } else {
          const milestone = await db.milestone.create({ data });
          existingByKey.set(key, { id: milestone.id });
          await writeAssignees(milestone.id);
          results.push({ row: rowNumber, status: "imported", warnings: warnList(warnings) });
          await logImportActivity(ctx, "imported", "milestone", milestone.id, title, {
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
