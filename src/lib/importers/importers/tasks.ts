/**
 * Tasks importer — bulk-create task records from CSV.
 *
 * Required: title
 * Optional: description, status, priority, dueDate, assigneeEmail,
 *           projectName, clientName
 *
 * createdById is set to the user who triggered the import.
 */

import type { TaskStatus, Priority } from "@prisma/client";
import { db } from "@/lib/db";
import { logActivity } from "@/lib/activity";
import type { ImporterDefinition, ImportRowResult } from "../types";

const VALID_STATUSES: TaskStatus[] = ["TODO", "IN_PROGRESS", "DONE", "CANCELLED"];
const VALID_PRIORITIES: Priority[] = ["HIGH", "MEDIUM", "LOW"];

function parseDate(v: string | undefined): Date | null {
  if (!v || v.trim() === "") return null;
  const d = new Date(v.trim());
  return isNaN(d.getTime()) ? null : d;
}

function formatDate(d: Date | null | undefined): string {
  return d ? d.toISOString().slice(0, 10) : "";
}

export const tasksImporter: ImporterDefinition = {
  key: "tasks",
  name: "Tasks",
  description:
    "Bulk-create tasks. Required: title. Optional: status, priority, due date, assignee email, project name, client name.",
  module: "tasks",

  fields: [
    { key: "title", label: "Title", required: true, aliases: ["task", "task title", "name"] },
    { key: "description", label: "Description", required: false, aliases: ["notes", "details"] },
    { key: "status", label: "Status", required: false, description: "TODO, IN_PROGRESS, DONE, CANCELLED. Defaults to TODO.", aliases: ["task status"] },
    { key: "priority", label: "Priority", required: false, description: "HIGH, MEDIUM, LOW. Defaults to MEDIUM.", aliases: ["task priority"] },
    { key: "dueDate", label: "Due date", required: false, aliases: ["due", "deadline"] },
    {
      key: "completedAt",
      label: "Completed at",
      required: false,
      description: "Date the task was completed. Auto-set if you set status=DONE without supplying this; only fill in when migrating historical completion timestamps.",
      aliases: ["completed", "completion date", "done at"],
    },
    {
      key: "sortOrder",
      label: "Sort order",
      required: false,
      description: "Integer; controls the order this task appears in kanban / list views within its column. Defaults to 0.",
      aliases: ["order", "position", "rank"],
    },
    { key: "assigneeEmail", label: "Assignee email", required: false, description: "Email of an existing active employee.", aliases: ["assignee", "owner", "assigned to"] },
    { key: "projectName", label: "Project name", required: false, description: "Optionally scope the task to a project (matched by name).", aliases: ["project"] },
    { key: "clientName", label: "Client name", required: false, description: "Optionally scope the task to a client (matched by name).", aliases: ["client", "company"] },
  ],

  async sampleRows() {
    const tasks = await db.task.findMany({
      orderBy: { createdAt: "desc" },
      take: 3,
      include: {
        assignee: { select: { email: true } },
        project: { select: { name: true } },
        client: { select: { name: true } },
      },
    });
    return tasks.map((t) => ({
      title: t.title,
      description: t.description || "",
      status: t.status,
      priority: t.priority,
      dueDate: formatDate(t.dueDate),
      completedAt: formatDate(t.completedAt),
      sortOrder: String(t.sortOrder),
      assigneeEmail: t.assignee?.email || "",
      projectName: t.project?.name || "",
      clientName: t.client?.name || "",
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

    for (let i = 0; i < rows.length; i++) {
      const rowNumber = i + 1;
      const raw = rows[i];
      const title = (raw.title || "").trim();
      if (!title) {
        failed++;
        results.push({ row: rowNumber, status: "failed", message: "Missing title" });
        continue;
      }

      const statusRaw = (raw.status || "TODO").trim().toUpperCase();
      const status = VALID_STATUSES.includes(statusRaw as TaskStatus)
        ? (statusRaw as TaskStatus)
        : null;
      if (!status) {
        failed++;
        results.push({ row: rowNumber, status: "failed", message: `Invalid status "${raw.status}"` });
        continue;
      }

      const priorityRaw = (raw.priority || "MEDIUM").trim().toUpperCase();
      const priority = VALID_PRIORITIES.includes(priorityRaw as Priority)
        ? (priorityRaw as Priority)
        : "MEDIUM";

      const assigneeEmail = (raw.assigneeEmail || "").trim().toLowerCase();
      const assigneeId = assigneeEmail ? userByEmail.get(assigneeEmail) || null : null;

      const projectName = (raw.projectName || "").trim().toLowerCase();
      const projectId = projectName ? projectByName.get(projectName) || null : null;

      const clientName = (raw.clientName || "").trim().toLowerCase();
      const clientId = clientName ? clientByName.get(clientName) || null : null;

      // completedAt: auto-set when status=DONE and the column wasn't
      // explicitly supplied. This mirrors the in-app behavior so
      // imported "done" tasks have a coherent completion timestamp.
      const completedAtRaw = parseDate(raw.completedAt);
      const completedAt =
        completedAtRaw ?? (status === "DONE" ? new Date() : null);

      const sortOrderRaw = (raw.sortOrder || "").trim();
      const sortOrder = sortOrderRaw ? parseInt(sortOrderRaw, 10) || 0 : 0;

      try {
        const task = await db.task.create({
          data: {
            title,
            description: raw.description?.trim() || null,
            status,
            priority,
            dueDate: parseDate(raw.dueDate),
            completedAt,
            sortOrder,
            assigneeId,
            projectId,
            clientId,
            createdById: ctx.triggeredBy,
          },
        });
        imported++;
        results.push({ row: rowNumber, status: "imported" });
        await logActivity("imported", "task", task.id, ctx.triggeredBy, title, {
          projectId: task.projectId,
          clientId: task.clientId,
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
