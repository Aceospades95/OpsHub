import { db } from "@/lib/db";
import { sendEmail } from "@/lib/email";
import { resolveRoleEmail } from "../context";
import { substituteVariables } from "../step-types";
import type { StepHandler } from "./index";
import type { SendReminderConfig } from "../step-types";

/**
 * SEND_REMINDER — operationally identical to SEND_EMAIL but distinct in
 * the audit log (eventType differentiates the two on the timeline).
 * The reminder template is a regular WorkflowEmailTemplate; what makes
 * it a "reminder" is the *intent* of the workflow author.
 */
export const sendReminderHandler: StepHandler = async ({
  config,
  context,
  instanceId,
}) => {
  const c = config as unknown as SendReminderConfig;
  if (!c.emailTemplateId) {
    throw new Error("send_reminder step is missing emailTemplateId");
  }

  const template = await db.workflowEmailTemplate.findUnique({
    where: { id: c.emailTemplateId },
  });
  if (!template) {
    throw new Error(`Reminder email template ${c.emailTemplateId} not found`);
  }

  const recipient = resolveRoleEmail(context, c.to);
  if (!recipient) {
    throw new Error(`Could not resolve reminder recipient role "${c.to}"`);
  }

  const result = await sendEmail(
    {
      to: recipient,
      subject: substituteVariables(template.subject, context as unknown as Record<string, unknown>),
      html: substituteVariables(template.bodyHtml, context as unknown as Record<string, unknown>),
      text: template.bodyText
        ? substituteVariables(template.bodyText, context as unknown as Record<string, unknown>)
        : undefined,
    },
    { entityType: "workflow", entityId: instanceId }
  );

  if (!result.success) {
    throw new Error(`Reminder email failed: ${result.error ?? "unknown"}`);
  }

  return {
    kind: "completed",
    output: {
      to: recipient,
      messageId: result.messageId ?? null,
      isReminder: true,
    },
  };
};
