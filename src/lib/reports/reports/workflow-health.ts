/**
 * workflow-health — running workflow instances with progress + last
 * step state. Pairs with the workflow analytics page; this report is
 * the snapshot you can email or download as a CSV.
 *
 * Lists every non-completed instance, computes done/total step counts,
 * and surfaces the most recent failed-step error if any. Operations
 * teams use this to spot stuck onboarding/offboarding flows quickly.
 */

import { db } from "@/lib/db";
import { format } from "date-fns";
import type { ReportDefinition } from "../types";

export const workflowHealth: ReportDefinition = {
  key: "workflow-health",
  name: "Workflow health",
  description:
    "Active workflow instances with step progress, last error, and how long they've been running. Use to spot stuck onboarding/offboarding flows.",
  module: "workflows",
  schedulable: true,

  async run() {
    const instances = await db.workflowInstance.findMany({
      where: { status: { in: ["PENDING", "IN_PROGRESS", "PAUSED"] } },
      include: {
        workflowTemplate: { select: { name: true } },
        steps: {
          select: {
            status: true,
            startedAt: true,
            completedAt: true,
            error: true,
            workflowStep: { select: { name: true, position: true } },
          },
        },
      },
      orderBy: { startDate: "desc" },
    });

    const now = new Date();
    const rows = instances.map((inst) => {
      const totalSteps = inst.steps.length;
      const doneSteps = inst.steps.filter(
        (s) => s.status === "COMPLETED" || s.status === "SKIPPED"
      ).length;
      const failedStep = inst.steps.find((s) => s.status === "FAILED");
      const inProgressStep = inst.steps
        .filter((s) => s.status === "IN_PROGRESS" || s.status === "PENDING")
        .sort(
          (a, b) =>
            (a.workflowStep?.position ?? 0) - (b.workflowStep?.position ?? 0)
        )[0];
      const ageDays = Math.floor(
        (now.getTime() - inst.startDate.getTime()) / (1000 * 60 * 60 * 24)
      );

      return {
        template: inst.workflowTemplate?.name ?? "—",
        subjectType: inst.subjectType,
        subjectId: inst.subjectId,
        status: inst.status,
        progress:
          totalSteps === 0
            ? "0 / 0"
            : `${doneSteps} / ${totalSteps}`,
        currentStep: inProgressStep?.workflowStep?.name ?? "—",
        startDate: inst.startDate,
        targetDate: inst.targetDate,
        ageDays,
        lastError: failedStep?.error ?? "—",
      };
    });

    const stuck = rows.filter((r) => r.lastError !== "—").length;
    const overdue = rows.filter(
      (r) => r.targetDate && r.targetDate < now && r.status !== "COMPLETED"
    ).length;

    return {
      summary:
        `${rows.length} active workflow instance${rows.length === 1 ? "" : "s"}` +
        (stuck > 0 ? ` · ${stuck} with errors` : "") +
        (overdue > 0 ? ` · ${overdue} past target date` : "") +
        ".",
      columns: [
        { key: "template", label: "Template" },
        { key: "subjectType", label: "Subject" },
        { key: "subjectId", label: "Subject ID" },
        { key: "status", label: "Status" },
        { key: "progress", label: "Progress", align: "right" },
        { key: "currentStep", label: "Current step" },
        {
          key: "startDate",
          label: "Started",
          format: (v) => (v instanceof Date ? format(v, "MMM d, yyyy") : "—"),
        },
        {
          key: "targetDate",
          label: "Target",
          format: (v) => (v instanceof Date ? format(v, "MMM d, yyyy") : "—"),
        },
        { key: "ageDays", label: "Days running", align: "right" },
        { key: "lastError", label: "Last error" },
      ],
      rows,
      emptyMessage: "No active workflow instances.",
    };
  },
};
