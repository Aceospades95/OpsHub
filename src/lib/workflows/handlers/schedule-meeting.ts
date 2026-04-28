import { db } from "@/lib/db";
import { substituteVariables } from "../step-types";
import type { StepHandler } from "./index";
import type { ScheduleMeetingConfig } from "../step-types";

/**
 * SCHEDULE_MEETING — Phase 4 generates a task on the workflow owner's
 * dashboard ("Schedule onboarding 1:1 with Alex Rivera, 30m") rather
 * than creating a real Calendar event. Phase 6 will detect a Google
 * Calendar connection and create the event directly when present,
 * falling back to the task on environments without it.
 *
 * Attendee role resolution is best-effort — for unmapped roles (HR/
 * IT/owner with no ThemeSetting yet) we list the role name in the
 * task description so an admin can fill in concrete invitees.
 */
export const scheduleMeetingHandler: StepHandler = async ({
  config,
  context,
  instanceStepId,
  subjectId,
  subjectType,
}) => {
  const c = config as unknown as ScheduleMeetingConfig;
  const title = substituteVariables(
    c.meetingTitle ?? "",
    context as unknown as Record<string, unknown>
  );

  const attendeeLines = (c.attendees ?? []).map((a) => {
    switch (a) {
      case "subject":
        return `• ${context.subject.fullName} (subject)`;
      case "manager":
        return context.manager.id
          ? `• ${context.manager.fullName} (manager)`
          : "• (manager — unresolved)";
      case "hr":
        return "• HR (no mapping configured yet)";
      case "it":
        return "• IT (no mapping configured yet)";
      case "owner":
        return "• Workflow owner";
      default:
        return `• ${a}`;
    }
  });

  const description = [
    `Duration: ${c.durationMinutes ?? 30} minutes`,
    "",
    "Attendees:",
    ...attendeeLines,
  ].join("\n");

  // Compute due date from the workflow startDate + offset days.
  const ms = 24 * 60 * 60 * 1000;
  const dueDate = new Date(
    new Date(context.workflow.startDate).getTime() +
      (c.offsetDays ?? 0) * ms
  );

  // Assignee defaults to subject's manager — they're typically the one
  // who'll send the calendar invite.
  const assigneeId =
    context.manager.id ??
    (subjectType === "EMPLOYEE" ? subjectId : null);

  if (!assigneeId) {
    throw new Error(
      "schedule_meeting: no manager and no employee subject to attribute the scheduling task to"
    );
  }

  const task = await db.task.create({
    data: {
      title: `Schedule: ${title || "(untitled meeting)"}`,
      description,
      status: "TODO",
      priority: "MEDIUM",
      dueDate,
      assigneeId,
      createdById: assigneeId,
      sourceType: "workflow_step",
      sourceId: instanceStepId,
    },
  });

  return {
    kind: "completed",
    output: { taskId: task.id, durationMinutes: c.durationMinutes },
  };
};
