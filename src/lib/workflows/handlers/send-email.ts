import { db } from "@/lib/db";
import { sendEmail } from "@/lib/email";
import { log } from "@/lib/log";
import { resolveRoleEmail } from "../context";
import { substituteVariables } from "../step-types";
import type { StepHandler } from "./index";
import type { SendEmailConfig } from "../step-types";

/**
 * Minimal sanity gate on the admin-entered custom recipient: control
 * characters (header-injection vectors), embedded spaces, more than
 * one "@", and over-long values (RFC 5321 caps the address at 254)
 * are rejected rather than passed to the email driver. Returns the
 * trimmed address, or null (logged) when it fails the gate.
 */
function sanitizeCustomEmail(value: string | undefined | null): string | null {
  const v = (value ?? "").trim();
  if (v.length === 0 || v.length > 254) return null;
  if (/[\r\n\0 ]/.test(v) || (v.match(/@/g) ?? []).length !== 1) {
    log.warn("workflows.send-email", "Skipping invalid custom recipient address", {
      address: v.slice(0, 80),
    });
    return null;
  }
  return v;
}

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
      ? sanitizeCustomEmail(c.customEmail)
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

  // Subject is plain text in headers; the bodyText path is plain too —
  // neither needs HTML escaping. The HTML body does: context values
  // come from User rows whose name/title/department fields are
  // user-editable and could contain markup.
  const subject = substituteVariables(subjectRaw, context as unknown as Record<string, unknown>);
  const html = substituteVariables(bodyRaw, context as unknown as Record<string, unknown>, "html");
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
