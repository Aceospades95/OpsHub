import { db } from "@/lib/db";
import { resolveRoleUserId } from "../context";
import type { StepHandler } from "./index";
import type { ProvisionAccessConfig } from "../step-types";

/**
 * PROVISION_ACCESS / DEPROVISION_ACCESS — Phase 4 doesn't ship API
 * integrations with Google Workspace, Slack, etc. Instead, both step
 * types create a checklist task on IT's dashboard (or the workflow
 * owner's, if no IT user is mapped) that says "Provision Slack for
 * Alex Rivera" — checking the task off completes the step.
 *
 * Phase 6 may layer real API integrations on top: detect the system
 * value and dispatch to a provider when one's wired in, falling back
 * to the checklist task for unknown systems.
 */
export const provisionAccessHandler: StepHandler = async (input) => {
  return await createAccessTask(input, "Provision");
};

export const deprovisionAccessHandler: StepHandler = async (input) => {
  return await createAccessTask(input, "Deprovision");
};

async function createAccessTask(
  input: Parameters<StepHandler>[0],
  verb: "Provision" | "Deprovision"
): Promise<Awaited<ReturnType<StepHandler>>> {
  const c = input.config as unknown as ProvisionAccessConfig;
  const system = c.system?.trim() || "(unspecified system)";

  // IT mapping isn't first-class yet — fall through to subject's
  // manager as a sane default for the seeded onboarding template.
  const itUserId = resolveRoleUserId(input.context, "it");
  const fallbackAssignee = itUserId ?? input.context.manager.id;

  const subjectName = input.context.subject.fullName || "(subject)";

  const createdById =
    fallbackAssignee ??
    (input.subjectType === "EMPLOYEE" ? input.subjectId : null);
  if (!createdById) {
    throw new Error(
      `${verb.toLowerCase()}_access: no IT/manager/subject available to attribute the task to`
    );
  }

  const task = await db.task.create({
    data: {
      title: `${verb} ${system} for ${subjectName}`,
      description: c.notes ?? null,
      status: "TODO",
      priority: "MEDIUM",
      assigneeId: fallbackAssignee,
      createdById,
      sourceType: "workflow_step",
      sourceId: input.instanceStepId,
    },
  });

  return {
    kind: "completed",
    output: { taskId: task.id, system, assigneeId: fallbackAssignee },
  };
}
