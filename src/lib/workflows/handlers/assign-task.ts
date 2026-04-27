import { db } from "@/lib/db";
import { resolveRoleUserId } from "../context";
import { substituteVariables } from "../step-types";
import { revalidateTask } from "@/lib/revalidate-entity";
import type { StepHandler } from "./index";
import type {
  AssignTaskToSubjectConfig,
  AssignTaskToUserConfig,
} from "../step-types";

/**
 * ASSIGN_TASK_TO_SUBJECT — creates a Task assigned to the workflow's
 * subject so the subject sees it on their portal checklist (Phase 5)
 * and on /tasks if they have OpsHub access. The dueDate is computed
 * from the workflow's startDate + the step's dueOffsetDays so the
 * deadline is aligned with the lifecycle, not with when the engine
 * happened to fire.
 */
export const assignTaskToSubjectHandler: StepHandler = async ({
  config,
  context,
  instanceStepId,
  subjectType,
  subjectId,
}) => {
  const c = config as unknown as AssignTaskToSubjectConfig;

  // Workflow tasks are subject-assigned. For EMPLOYEE workflows the
  // subject IS a User so we can wire the assigneeId; for CANDIDATE
  // (Phase 5+) the task lives on the portal and assigneeId stays null.
  const assigneeId = subjectType === "EMPLOYEE" ? subjectId : null;
  const dueDate = computeDueDate(
    context.workflow.startDate,
    c.dueOffsetDays
  );

  const title = substituteVariables(c.title ?? "", context as unknown as Record<string, unknown>);
  const description = c.description
    ? substituteVariables(c.description, context as unknown as Record<string, unknown>)
    : null;

  const task = await db.task.create({
    data: {
      title,
      description,
      status: "TODO",
      priority: "MEDIUM",
      assigneeId,
      dueDate,
      // Workflow-created tasks need a `createdBy` — use the subject when
      // it's an employee, falling back to the workflow creator (we don't
      // have direct access to that here, so the subject is good enough
      // for an audit purpose). If even that's null, we have to skip.
      createdById: assigneeId ?? subjectId,
      sourceType: "workflow_step",
      sourceId: instanceStepId,
    },
  });
  if (assigneeId) revalidateTask({ assigneeId });

  return {
    kind: "completed",
    output: { taskId: task.id, dueDate: dueDate?.toISOString() ?? null },
  };
};

/**
 * ASSIGN_TASK_TO_USER — creates a Task on the dashboard of a specific
 * user or a role-resolved user (manager/HR/IT/owner). Same dueDate
 * math as the subject variant.
 *
 * If the role doesn't resolve to a User (e.g. HR/IT/owner have no
 * mapping yet — Phase 6 work), the task is created assignee-less so
 * an admin can claim it from /tasks. We log a hint in the output.
 */
export const assignTaskToUserHandler: StepHandler = async ({
  config,
  context,
  instanceStepId,
  subjectId,
  subjectType,
}) => {
  const c = config as unknown as AssignTaskToUserConfig;

  const assigneeId = resolveRoleUserId(
    context,
    c.assignee,
    c.assigneeUserId ?? null
  );
  const dueDate = computeDueDate(
    context.workflow.startDate,
    c.dueOffsetDays
  );

  const title = substituteVariables(c.title ?? "", context as unknown as Record<string, unknown>);
  const description = c.description
    ? substituteVariables(c.description, context as unknown as Record<string, unknown>)
    : null;

  // Tasks need a createdById. Use the assignee if known, else the
  // subject (when subject is a User), else fail loudly.
  const createdById =
    assigneeId ??
    (subjectType === "EMPLOYEE" ? subjectId : null);
  if (!createdById) {
    throw new Error(
      "assign_task_to_user: cannot determine createdById (no resolved assignee, subject is not an employee)"
    );
  }

  const task = await db.task.create({
    data: {
      title,
      description,
      status: "TODO",
      priority: "MEDIUM",
      assigneeId,
      dueDate,
      createdById,
      sourceType: "workflow_step",
      sourceId: instanceStepId,
    },
  });
  if (assigneeId) revalidateTask({ assigneeId });

  return {
    kind: "completed",
    output: {
      taskId: task.id,
      assigneeId,
      assigneeUnresolved: assigneeId == null,
    },
  };
};

function computeDueDate(startDate: Date, offsetDays: number): Date | null {
  if (!Number.isFinite(offsetDays)) return null;
  const ms = 24 * 60 * 60 * 1000;
  const start = startDate instanceof Date ? startDate : new Date(startDate);
  return new Date(start.getTime() + offsetDays * ms);
}
