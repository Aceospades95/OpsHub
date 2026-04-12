/**
 * team-utilization — sum of active FTE allocations per employee, plus
 * the list of projects they're on.
 *
 * Helps staffing/capacity planning: anyone over 1.0 FTE is over-allocated,
 * anyone under is bench-time.
 */

import { db } from "@/lib/db";
import type { ReportDefinition } from "../types";

export const teamUtilization: ReportDefinition = {
  key: "team-utilization",
  name: "Team utilization",
  description:
    "Total active FTE allocation per employee, with a list of the projects they're currently assigned to.",
  module: "team",
  schedulable: true,

  async run() {
    const users = await db.user.findMany({
      where: { isActive: true, hasLoginAccess: true },
      select: {
        id: true,
        name: true,
        jobTitle: true,
        department: true,
        assignments: {
          where: { status: "ACTIVE" },
          select: {
            allocationFte: true,
            project: { select: { name: true } },
            client: { select: { name: true } },
          },
        },
      },
      orderBy: { name: "asc" },
    });

    const rows = users.map((u) => {
      const totalFte = u.assignments.reduce(
        (sum, a) => sum + (a.allocationFte || 0),
        0
      );
      const projectList = u.assignments
        .map((a) => a.project?.name || a.client?.name)
        .filter(Boolean)
        .join(", ");
      return {
        name: u.name,
        jobTitle: u.jobTitle || "—",
        department: u.department || "—",
        assignmentCount: u.assignments.length,
        totalFte: Number(totalFte.toFixed(2)),
        projects: projectList || "—",
      };
    });

    const overAllocated = rows.filter((r) => r.totalFte > 1).length;
    const benched = rows.filter((r) => r.totalFte === 0).length;

    return {
      summary: `${rows.length} active employees · ${overAllocated} over-allocated (>1.0 FTE) · ${benched} with no active assignments.`,
      columns: [
        { key: "name", label: "Employee" },
        { key: "jobTitle", label: "Title" },
        { key: "department", label: "Department" },
        { key: "assignmentCount", label: "Assignments", align: "right" },
        {
          key: "totalFte",
          label: "Total FTE",
          align: "right",
          format: (v) => (typeof v === "number" ? v.toFixed(2) : String(v)),
        },
        { key: "projects", label: "Projects" },
      ],
      rows,
      emptyMessage: "No active employees.",
    };
  },
};
