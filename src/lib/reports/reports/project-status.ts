/**
 * project-status — active project portfolio snapshot: status, client,
 * milestone completion, and open task counts.
 */

import { db } from "@/lib/db";
import type { ReportDefinition } from "../types";

export const projectStatus: ReportDefinition = {
  key: "project-status",
  name: "Project portfolio status",
  description:
    "Active and planning projects with status, client, milestone progress, and open task counts.",
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

    const rows = projects.map((p) => {
      const totalMilestones = p.milestones.length;
      const doneMilestones = p.milestones.filter((m) => m.completed).length;
      const openTasks = p.tasks.filter(
        (t) => t.status === "TODO" || t.status === "IN_PROGRESS"
      ).length;
      return {
        name: p.name,
        client: p.client?.name || "—",
        status: p.status,
        startDate: p.startDate,
        endDate: p.endDate,
        milestones:
          totalMilestones === 0
            ? "0 / 0"
            : `${doneMilestones} / ${totalMilestones}`,
        openTasks,
        teamSize: p._count.assignments,
      };
    });

    const byStatus = rows.reduce<Record<string, number>>((acc, r) => {
      acc[r.status] = (acc[r.status] || 0) + 1;
      return acc;
    }, {});
    const statusSummary = Object.entries(byStatus)
      .map(([k, v]) => `${v} ${k.toLowerCase()}`)
      .join(" · ");

    return {
      summary: `${rows.length} active portfolio projects${statusSummary ? ` · ${statusSummary}` : ""}.`,
      columns: [
        { key: "name", label: "Project" },
        { key: "client", label: "Client" },
        { key: "status", label: "Status" },
        { key: "startDate", label: "Start" },
        { key: "endDate", label: "End" },
        { key: "milestones", label: "Milestones" },
        { key: "openTasks", label: "Open tasks", align: "right" },
        { key: "teamSize", label: "Team", align: "right" },
      ],
      rows,
      emptyMessage: "No active projects.",
    };
  },
};
