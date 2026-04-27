import { db } from "@/lib/db";
import { sendEmail } from "@/lib/email";
import { resolveRoleEmail } from "../context";
import { substituteVariables } from "../step-types";
import type { StepHandler } from "./index";
import type { SendEmailConfig } from "../step-types";

/**
 * SEND_EMAIL step — looks up the user-editable WorkflowEmailTemplate,
 * substitutes `{{path}}` tokens against the instance context, resolves
 * the recipient role to a concrete email, and sends through the
 * existing email driver.
 *
 * Failure modes:
 *   - Template missing → throw (engine marks step FAILED, instance
 *     pauses if step was required).
 *   - Recipient unresolvable → throw with a descriptive message so
 *     the admin can see exactly which role was missing on the subject.
 *   - Driver send error → propagated as throw.
 */
export const sendEmailHandler: StepHandler = async ({
  config,
  context,
  instanceId,
}) => {
  const c = config as unknown as SendEmailConfig;

  if (!c.emailTemplateId) {
    throw new Error("send_email step is missing emailTemplateId");
  }
  const template = await db.workflowEmailTemplate.findUnique({
    where: { id: c.emailTemplateId },
  });
  if (!template) {
    throw new Error(`Email template ${c.emailTemplateId} not found`);
  }

  const recipient =
    c.toRecipient === "custom"
      ? c.customEmail ?? null
      : resolveRoleEmail(context, c.toRecipient);
  if (!recipient) {
    throw new Error(
      `Could not resolve recipient role "${c.toRecipient}" for this instance`
    );
  }

  const subjectRaw = c.subjectOverride?.trim()
    ? c.subjectOverride
    : template.subject;
  const bodyRaw = c.bodyOverride?.trim() ? c.bodyOverride : template.bodyHtml;

  const subject = substituteVariables(subjectRaw, context as unknown as Record<string, unknown>);
  const html = substituteVariables(bodyRaw, context as unknown as Record<string, unknown>);
  const text = template.bodyText
    ? substituteVariables(template.bodyText, context as unknown as Record<string, unknown>)
    : undefined;

  const result = await sendEmail(
    {
      to: recipient,
      subject,
      html,
      text,
    },
    {
      entityType: "workflow",
      entityId: instanceId,
    }
  );

  if (!result.success) {
    throw new Error(`Email send failed: ${result.error ?? "unknown"}`);
  }

  return {
    kind: "completed",
    output: {
      to: recipient,
      messageId: result.messageId ?? null,
      templateId: template.id,
    },
  };
};
