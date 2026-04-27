/**
 * project-status — active project portfolio snapshot: status, client,
 * milestone completion, and open task counts.
 */

import { db } from "@/lib/db";
import { format } from "date-fns";
import type { ReportDefinition } from "../types";

export const projectStatus: ReportDefinition = {
  key: "project-status",
  name: "Project portfolio status",
  description:
    "Active and planning projects with status, client, milestone progress, open task count, team size, and a flag for projects past their end date. Headline includes overdue count so PMOs can triage.",
  module: "projects",
  schedulable: true,

  async run() {
    const projects = await db.project.findMany({
      where: {
        status: { in: ["PLANNING", "ACTIVE", "ON_HOLD"] },
      },
      include: {
        client: { select: { name: true } },
        milestones: { select: { completed: true } },
        tasks: { select: { status: true } },
        _count: {
          select: { members: true, assignments: { where: { status: "ACTIVE" } } },
        },
      },
      orderBy: { name: "asc" },
    });

    const now = new Date();
    const rows = projects.map((p) => {
      const totalMilestones = p.milestones.length;
      const doneMilestones = p.milestones.filter((m) => m.completed).length;
      const milestonePct =
        totalMilestones === 0
          ? null
          : Math.round((doneMilestones / totalMilestones) * 100);
      const openTasks = p.tasks.filter(
        (t) => t.status === "TODO" || t.status === "IN_PROGRESS"
      ).length;
      const isOverdue =
        p.endDate != null && p.endDate < now && p.status !== "COMPLETED";

      return {
        name: p.name,
        client: p.client?.name || "—",
        status: p.status,
        startDate: p.startDate,
        endDate: p.endDate,
        milestones:
          totalMilestones === 0
            ? "0 / 0"
            : `${doneMilestones} / ${totalMilestones}` +
              (milestonePct != null ? ` (${milestonePct}%)` : ""),
        openTasks,
        teamSize: p._count.assignments,
        flag: isOverdue ? "Overdue" : "",
      };
    });

    const byStatus = rows.reduce<Record<string, number>>((acc, r) => {
      acc[r.status] = (acc[r.status] || 0) + 1;
      return acc;
    }, {});
    const statusSummary = Object.entries(byStatus)
      .map(([k, v]) => `${v} ${k.toLowerCase()}`)
      .join(" · ");
    const overdueCount = rows.filter((r) => r.flag === "Overdue").length;

    return {
      summary:
        `${rows.length} active portfolio projects` +
        (statusSummary ? ` · ${statusSummary}` : "") +
        (overdueCount > 0 ? ` · ${overdueCount} past end date` : "") +
        ".",
      columns: [
        { key: "name", label: "Project" },
        { key: "client", label: "Client" },
        { key: "status", label: "Status" },
        {
          key: "startDate",
          label: "Start",
          format: (v) => (v instanceof Date ? format(v, "MMM d, yyyy") : "—"),
        },
        {
          key: "endDate",
          label: "End",
          format: (v) => (v instanceof Date ? format(v, "MMM d, yyyy") : "—"),
        },
        { key: "milestones", label: "Milestones" },
        { key: "openTasks", label: "Open tasks", align: "right" },
        { key: "teamSize", label: "Team", align: "right" },
        { key: "flag", label: "Flag" },
      ],
      rows,
      emptyMessage: "No active projects.",
    };
  },
};
