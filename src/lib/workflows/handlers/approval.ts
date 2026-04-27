import { db } from "@/lib/db";
import { resolveRoleUserId } from "../context";
import { substituteVariables } from "../step-types";
import type { StepHandler } from "./index";
import type { ApprovalConfig } from "../step-types";

/**
 * APPROVAL step — pauses progress on the timeline until the designated
 * approver explicitly clicks approve/reject in the instance detail UI.
 *
 * On entry: create a task on the approver's dashboard so they see the
 * gate sitting on their queue, then return "waiting" so the engine
 * leaves the step IN_PROGRESS until completeStep() is called by the
 * approval action (`approveInstanceStep` in actions/workflow-instances.ts).
 */
export const approvalHandler: StepHandler = async ({
  config,
  context,
  instanceId,
  instanceStepId,
}) => {
  const c = config as unknown as ApprovalConfig;

  const approverId = resolveRoleUserId(
    context,
    c.approver,
    c.approverUserId ?? null
  );
  const prompt = substituteVariables(
    c.prompt ?? "",
    context as unknown as Record<string, unknown>
  );

  if (approverId) {
    await db.task.create({
      data: {
        title: `Approve: ${prompt || "(no prompt)"}`,
        description: `Workflow ${context.workflow.name} is paused awaiting approval. Open the instance to approve or reject.`,
        status: "TODO",
        priority: "HIGH",
        assigneeId: approverId,
        createdById: approverId,
        sourceType: "workflow_step",
        sourceId: instanceStepId,
      },
    });
  }

  await db.workflowEvent.create({
    data: {
      workflowInstanceId: instanceId,
      eventType: "approval_requested",
      actorType: "system",
      metadata: JSON.stringify({
        approverUserId: approverId,
        prompt,
      }),
    },
  });

  return { kind: "waiting", output: { approverId, prompt } };
};
