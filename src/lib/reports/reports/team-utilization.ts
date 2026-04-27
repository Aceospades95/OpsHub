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
    "Total active FTE allocation per employee, with manager, projects, and a status flag for over- or under-allocated. Sums total committed FTE in the headline so capacity planning can be done at a glance.",
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
        manager: { select: { name: true } },
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
      const status =
        totalFte === 0
          ? "Bench"
          : totalFte > 1.05
            ? "Over"
            : totalFte < 0.5
              ? "Under"
              : "OK";
      return {
        name: u.name,
        jobTitle: u.jobTitle || "—",
        department: u.department || "—",
        manager: u.manager?.name || "—",
        assignmentCount: u.assignments.length,
        totalFte: Number(totalFte.toFixed(2)),
        status,
        projects: projectList || "—",
      };
    });

    const overAllocated = rows.filter((r) => r.status === "Over").length;
    const underAllocated = rows.filter((r) => r.status === "Under").length;
    const benched = rows.filter((r) => r.status === "Bench").length;
    const totalCommittedFte = rows.reduce((sum, r) => sum + r.totalFte, 0);

    return {
      summary:
        `${rows.length} active employees · ${totalCommittedFte.toFixed(1)} FTE committed` +
        (overAllocated > 0 ? ` · ${overAllocated} over-allocated (>1.05)` : "") +
        (underAllocated > 0 ? ` · ${underAllocated} under-allocated (<0.5)` : "") +
        (benched > 0 ? ` · ${benched} on bench` : "") +
        ".",
      columns: [
        { key: "name", label: "Employee" },
        { key: "jobTitle", label: "Title" },
        { key: "department", label: "Department" },
        { key: "manager", label: "Manager" },
        { key: "assignmentCount", label: "Assignments", align: "right" },
        {
          key: "totalFte",
          label: "Total FTE",
          align: "right",
          format: (v) => (typeof v === "number" ? v.toFixed(2) : String(v)),
        },
        { key: "status", label: "Status" },
        { key: "projects", label: "Projects" },
      ],
      rows,
      emptyMessage: "No active employees.",
    };
  },
};
