/**
 * Step-handler registry.
 *
 * Each WorkflowStepType has a handler that receives the step's config,
 * the resolved instance context, and identifying ids. The handler
 * returns one of three outcomes:
 *
 *   { kind: "completed", output? } — step is done; engine marks
 *       COMPLETED and recomputes downstream AFTER_STEP scheduling.
 *
 *   { kind: "waiting", output? }   — handler did its work but the
 *       step won't be marked COMPLETED until something external
 *       happens (approval clicked, document uploaded). Status stays
 *       IN_PROGRESS until completeStep() is called from a server
 *       action or the portal.
 *
 *   { kind: "skipped", reason? }   — short-circuit (e.g. conditional
 *       branch evaluated false). Treated as terminal for downstream
 *       AFTER_STEP scheduling.
 *
 * Throwing inside a handler is captured by the engine and turns the
 * step into FAILED with the exception message — so handlers can rely
 * on standard error propagation rather than typed result wrappers.
 */

import type { WorkflowStepType, WorkflowSubjectType } from "@prisma/client";
import type { WorkflowContext } from "../context";

import { sendEmailHandler } from "./send-email";
import { assignTaskToSubjectHandler, assignTaskToUserHandler } from "./assign-task";
import { waitHandler } from "./wait";
import { conditionalBranchHandler } from "./conditional-branch";
import { approvalHandler } from "./approval";
import { provisionAccessHandler, deprovisionAccessHandler } from "./provision-access";
import { scheduleMeetingHandler } from "./schedule-meeting";
import { sendReminderHandler } from "./send-reminder";
import { portalWaitHandler } from "./portal-wait";

export type StepHandlerOutcome =
  | { kind: "completed"; output?: unknown }
  | { kind: "waiting"; output?: unknown }
  | { kind: "skipped"; reason?: string };

export interface StepHandlerInput {
  stepType: WorkflowStepType;
  config: Record<string, unknown>;
  context: WorkflowContext;
  instanceId: string;
  instanceStepId: string;
  subjectType: WorkflowSubjectType;
  subjectId: string;
}

export type StepHandler = (
  input: StepHandlerInput
) => Promise<StepHandlerOutcome>;

const HANDLERS: Record<WorkflowStepType, StepHandler> = {
  SEND_EMAIL: sendEmailHandler,
  ASSIGN_TASK_TO_SUBJECT: assignTaskToSubjectHandler,
  ASSIGN_TASK_TO_USER: assignTaskToUserHandler,
  WAIT: waitHandler,
  CONDITIONAL_BRANCH: conditionalBranchHandler,
  APPROVAL: approvalHandler,
  PROVISION_ACCESS: provisionAccessHandler,
  DEPROVISION_ACCESS: deprovisionAccessHandler,
  SCHEDULE_MEETING: scheduleMeetingHandler,
  SEND_REMINDER: sendReminderHandler,
  // Portal-driven steps (subject completes them via the Phase 5 portal).
  // Phase 4 marks them as "waiting" so the timeline shows them in
  // progress and the portal can complete them later.
  REQUEST_DOCUMENT: portalWaitHandler,
  REQUEST_SIGNATURE: portalWaitHandler,
  REQUEST_FORM: portalWaitHandler,
};

export async function runStepHandler(
  input: StepHandlerInput
): Promise<StepHandlerOutcome> {
  const handler = HANDLERS[input.stepType];
  if (!handler) {
    throw new Error(`No handler registered for step type ${input.stepType}`);
  }
  return handler(input);
}
